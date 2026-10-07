import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stopWindowsProcessTree } from "./windows-process-tree.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const processTreeFileEnv = "API_TEST_RUNNER_PROCESS_TREE_FILE";
const windowsPidReuseRegression =
  windows
  && process.env.NODE_ENV !== "production"
  && process.env.API_TEST_RUNNER_WINDOWS_PID_REUSE_REGRESSION === "1";
const interruptRegression =
  process.env.NODE_ENV !== "production"
  && process.env.API_TEST_RUNNER_INTERRUPT_REGRESSION === "1";
const markerPrefix = "[API_TEST_RUNNER_INTERRUPT]";
const shutdownGraceMs = 5_000;
const shutdownForceWaitMs = 5_000;
const windowsProcessTreeFile = windows
  ? process.env[processTreeFileEnv]
    ?? path.join(os.tmpdir(), `sitecheck-api-runner-tree-${process.pid}-${randomUUID()}.jsonl`)
  : null;
const trackerPath = path.join(packageRoot, "tests/windows-process-tree-tracker.mjs");
const trackerOption = `--import=${pathToFileURL(trackerPath).href}`;
const managedProcesses = [];
let receivedSignal = null;
let shutdownPromise = null;
let shutdownError = null;
let testMediaStorageDir;

function reportInterruptRegressionEvent(event, details = {}) {
  if (!interruptRegression) return;
  console.log(`${markerPrefix}${JSON.stringify({ event, ...details })}`);
}

function trackingEnvironment(environment) {
  const tracked = { ...environment };
  if (!windows) return tracked;
  tracked[processTreeFileEnv] = windowsProcessTreeFile;
  const nodeOptions = typeof tracked.NODE_OPTIONS === "string" ? tracked.NODE_OPTIONS : "";
  if (!nodeOptions.includes(trackerOption)) {
    tracked.NODE_OPTIONS = `${nodeOptions} ${trackerOption}`.trim();
  }
  return tracked;
}

function spawnManaged(command, args, options) {
  const startedAtMs = Date.now();
  const child = spawn(command, args, {
    ...options,
    env: trackingEnvironment(options.env ?? process.env),
  });
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal, error: spawnError }));
  });
  const managed = { child, startedAtMs, closed };
  managedProcesses.push(managed);
  return managed;
}

async function waitForManagedClose(managed, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      managed.closed,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function stopManagedProcess(managed, signal = "SIGTERM") {
  if (!managed) return;
  if (managed.stopPromise) return managed.stopPromise;
  managed.stopPromise = (async () => {
    if (!Number.isSafeInteger(managed.child.pid) || managed.child.pid <= 1) {
      const result = await waitForManagedClose(managed, shutdownGraceMs);
      if (!result) throw new Error("A spawned API test process did not close after its spawn failed.");
      return;
    }

    if (windows) {
      try {
        await stopWindowsProcessTree({
          rootPid: managed.child.pid,
          rootStartedAtMs: managed.startedAtMs,
          processTreeFile: windowsProcessTreeFile,
          initialSignal: signal,
          graceMs: shutdownGraceMs,
          forceWaitMs: shutdownForceWaitMs,
          rootChild: managed.child,
        });
      } catch (error) {
        if (windowsPidReuseRegression) {
          reportInterruptRegressionEvent("windows-process-tree-stop-refused", {
            processId: managed.child.pid,
            processStartedAtMs: managed.startedAtMs,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    } else if (managed.child.exitCode === null && managed.child.signalCode === null) {
      managed.child.kill(signal);
      if (!await waitForManagedClose(managed, shutdownGraceMs)) {
        managed.child.kill("SIGKILL");
      }
    }

    if (!await waitForManagedClose(managed, shutdownForceWaitMs)) {
      throw new Error(`API test process ${managed.child.pid} remained live after shutdown.`);
    }
  })();
  return managed.stopPromise;
}

function stopAllManagedProcesses(signal = "SIGTERM") {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const errors = [];
    for (const managed of [...managedProcesses].reverse()) {
      try {
        await stopManagedProcess(managed, signal);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, "One or more API test process trees could not be stopped.");
    }
  })();
  return shutdownPromise;
}

function handleProcessSignal(signal) {
  if (receivedSignal) return;
  receivedSignal = signal;
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  void stopAllManagedProcesses(signal).catch((error) => {
    shutdownError = error;
  });
}

const handleSigint = () => handleProcessSignal("SIGINT");
const handleSigterm = () => handleProcessSignal("SIGTERM");
process.on("SIGINT", handleSigint);
process.on("SIGTERM", handleSigterm);
if (windowsPidReuseRegression && typeof process.send === "function") {
  process.on("message", (message) => {
    if (
      message?.type !== "interrupt-regression-signal"
      || !["SIGINT", "SIGTERM"].includes(message.signal)
    ) {
      return;
    }
    reportInterruptRegressionEvent("interrupt-regression-signal-received", {
      signal: message.signal,
    });
    process.emit(message.signal);
  });
}

async function waitForSpawn(managed) {
  if (Number.isSafeInteger(managed.child.pid)) return;
  await new Promise((resolve, reject) => {
    managed.child.once("spawn", resolve);
    managed.child.once("error", reject);
  });
}

async function runWindowsPidReuseRegression() {
  await writeFile(windowsProcessTreeFile, "", { flag: "a" });
  const fixturePath = path.join(packageRoot, "tests/fixtures/windows-pid-reuse-fixture.cjs");
  const tests = spawnManaged(process.execPath, [fixturePath], {
    cwd: packageRoot,
    env: { ...process.env, NODE_ENV: "test" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await waitForSpawn(tests);
  reportInterruptRegressionEvent("tests-started", {
    processId: tests.child.pid,
    processStartedAtMs: tests.startedAtMs,
  });
  const result = await tests.closed;
  if (result.error) throw result.error;
  if (!receivedSignal && result.code !== 0) {
    throw new Error(`The Windows PID-reuse fixture exited with code ${result.code ?? "unknown"}.`);
  }
}

async function runApiTests() {
  if (receivedSignal) return;
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (receivedSignal) return;
  testMediaStorageDir = await mkdtemp(path.join(os.tmpdir(), "sitecheck-media-storage-"));
  if (receivedSignal) return;

  const server = spawnManaged(
    process.execPath,
    ["--enable-source-maps", "./dist/index.mjs"],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "test",
        TEST_MEDIA_STORAGE_DIR: testMediaStorageDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let serverOutput = "";
  server.child.stdout.on("data", (chunk) => {
    serverOutput += chunk;
  });
  server.child.stderr.on("data", (chunk) => {
    serverOutput += chunk;
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (receivedSignal) break;
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (receivedSignal) return;
  if (!ready) {
    throw new Error(`Test API did not start.\n${serverOutput}`);
  }

  const tests = spawnManaged(
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      "src/lib/orphaned-finding-media-cleanup.test.ts",
      "src/routes/report-policy.test.ts",
      "tests/report-api.test.mjs",
    ],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        TEST_API_BASE_URL: baseUrl,
        TEST_MEDIA_STORAGE_DIR: testMediaStorageDir,
      },
      stdio: "inherit",
    },
  );
  const result = await tests.closed;
  if (result.error) throw result.error;
  process.exitCode = receivedSignal
    ? receivedSignal === "SIGINT" ? 130 : 143
    : result.code ?? 1;
}

let runError;
try {
  if (windowsPidReuseRegression) {
    await runWindowsPidReuseRegression();
  } else {
    if (windowsProcessTreeFile) await writeFile(windowsProcessTreeFile, "", { flag: "a" });
    await runApiTests();
  }
} catch (error) {
  runError = error;
} finally {
  try {
    await stopAllManagedProcesses(receivedSignal ?? "SIGTERM");
  } catch (error) {
    shutdownError ??= error;
  }
  if (testMediaStorageDir) {
    try {
      await rm(testMediaStorageDir, { recursive: true, force: true });
    } catch (error) {
      shutdownError ??= error;
    }
  }
  if (windowsProcessTreeFile && !windowsPidReuseRegression) {
    try {
      await rm(windowsProcessTreeFile, { force: true });
    } catch (error) {
      shutdownError ??= error;
    }
  }
}

process.off("SIGINT", handleSigint);
process.off("SIGTERM", handleSigterm);
if (runError || shutdownError) {
  const errors = [runError, shutdownError].filter(Boolean);
  console.error(errors.length === 1 ? errors[0] : new AggregateError(errors, "The API test runner failed."));
  if (!process.exitCode) process.exitCode = 1;
}