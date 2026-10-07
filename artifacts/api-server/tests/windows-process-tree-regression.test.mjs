import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  appendWindowsProcessTreeRecord,
  inspectWindowsProcessTree,
  inspectWindowsProcessTreeFromSnapshot,
  readWindowsProcessSnapshot,
  stopWindowsProcessTree,
} from "./windows-process-tree.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = path.join(packageRoot, "tests/run.mjs");
const fixturePath = path.join(packageRoot, "tests/fixtures/windows-pid-reuse-fixture.cjs");
const markerPrefix = "[API_TEST_RUNNER_INTERRUPT]";
const PROCESS_START_TIME_TOLERANCE_MS = 2_000;

function readMarkerLines(text, onMarker) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(markerPrefix)) continue;
    try {
      onMarker(JSON.parse(line.slice(markerPrefix.length)));
    } catch {
      // The assertion that waits for the expected marker reports malformed output.
    }
  }
}

async function waitForWindowsProcessInfo(processId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const processInfo = (await readWindowsProcessSnapshot())
      .find((candidate) => candidate.processId === processId);
    if (processInfo && processInfo.creationTimeMs > 0) return processInfo;
    await delay(100);
  }
  throw new Error(`Timed out waiting for Windows process ${processId} to appear in a process snapshot.`);
}

async function waitForPromiseOrTimeout(promise, timeoutMs) {
  const controller = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(timeoutMs, null, { signal: controller.signal }),
    ]);
  } finally {
    controller.abort();
  }
}

async function stopOwnedFixture(child, closed) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    assert.equal(child.connected, true, "The harness-owned fixture must retain its private IPC cleanup channel.");
    await new Promise((resolve, reject) => {
      child.send({ type: "stop" }, (error) => error ? reject(error) : resolve());
    });
  }
  const result = await waitForPromiseOrTimeout(closed, 10_000);
  assert.ok(result, "The harness-owned fixture must exit after its IPC cleanup request.");
  assert.equal(result.code, 0, "The harness-owned fixture must exit normally.");
  assert.equal(result.signal, null, "The harness must stop the fixture through IPC, not by signalling a PID.");
}

test("Windows process snapshots reject a tracked PID whose live start identity differs", () => {
  const rootPid = 6_100;
  const reusedPid = 6_300;
  const rootStartedAtMs = 1_800_000_200_000;
  const staleStartedAtMs = rootStartedAtMs + 10;

  assert.throws(
    () => inspectWindowsProcessTreeFromSnapshot({
      rootPid,
      rootStartedAtMs,
      records: [{
        event: "start",
        parentPid: rootPid,
        processId: reusedPid,
        startedAtMs: staleStartedAtMs,
      }],
      snapshot: [
        { processId: rootPid, parentPid: 1, creationTimeMs: rootStartedAtMs },
        {
          processId: reusedPid,
          parentPid: 55,
          creationTimeMs: staleStartedAtMs + PROCESS_START_TIME_TOLERANCE_MS + 1,
        },
      ],
    }),
    new RegExp(`Could not verify the identity of Windows process ${reusedPid}; cleanup is unsafe\\.`),
  );
});

test(
  "Windows runner refuses a reused tracked PID and leaves the harness fixture alive",
  { skip: process.platform !== "win32", timeout: 120_000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "windows-pid-reuse-regression-"));
    const processTreeFile = path.join(tempDir, "process-tree.jsonl");
    const verifiedProcessTreeFile = path.join(tempDir, "verified-process-tree.jsonl");
    const events = new Map();
    let runnerOutput = "";
    let runnerPending = "";
    let runner;
    let runnerClosed;
    let runnerResult;
    let replacementFixture;
    let replacementClosed;
    let testProcessEvent;

    const runnerEnv = {
      ...process.env,
      NODE_ENV: "test",
      API_TEST_RUNNER_INTERRUPT_REGRESSION: "1",
      API_TEST_RUNNER_WINDOWS_PID_REUSE_REGRESSION: "1",
      API_TEST_RUNNER_PROCESS_TREE_FILE: processTreeFile,
    };
    delete runnerEnv.NODE_TEST_CONTEXT;

    const handleRunnerOutput = (chunk) => {
      const text = chunk.toString();
      runnerOutput = `${runnerOutput}${text}`.slice(-32 * 1024);
      runnerPending += text;
      const lines = runnerPending.split(/\r?\n/);
      runnerPending = lines.pop() ?? "";
      readMarkerLines(lines.join("\n"), (event) => {
        events.set(event.event, event);
        if (event.event === "tests-started") testProcessEvent = event;
      });
    };

    const waitForEvent = async (name, timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (events.has(name)) return events.get(name);
        if (runnerResult) throw new Error(`The API runner exited before ${name}: ${runnerOutput}`);
        await delay(25);
      }
      throw new Error(`Timed out waiting for API runner event ${name}: ${runnerOutput}`);
    };

    try {
      runner = spawn(process.execPath, [runnerPath], {
        cwd: packageRoot,
        env: runnerEnv,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      runner.stdout.on("data", handleRunnerOutput);
      runner.stderr.on("data", handleRunnerOutput);
      runnerClosed = new Promise((resolve) => {
        runner.once("close", (code, signal) => {
          runnerResult = { code, signal };
          resolve(runnerResult);
        });
      });

      testProcessEvent = await waitForEvent("tests-started");
      const runnerProcessInfo = await waitForWindowsProcessInfo(testProcessEvent.processId);
      assert.ok(
        Math.abs(runnerProcessInfo.creationTimeMs - testProcessEvent.processStartedAtMs)
          <= PROCESS_START_TIME_TOLERANCE_MS,
        "The tracked runner start time must identify the live test process.",
      );

      await delay(PROCESS_START_TIME_TOLERANCE_MS + 1_000);
      replacementFixture = fork(fixturePath, [], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
      replacementClosed = new Promise((resolve) => {
        replacementFixture.once("close", (code, signal) => resolve({ code, signal }));
      });
      await new Promise((resolve, reject) => {
        replacementFixture.once("spawn", resolve);
        replacementFixture.once("error", reject);
      });
      const replacementBeforeRefusal = await waitForWindowsProcessInfo(replacementFixture.pid);
      const staleStartedAtMs = testProcessEvent.processStartedAtMs + 10;
      assert.ok(
        replacementBeforeRefusal.creationTimeMs > staleStartedAtMs + PROCESS_START_TIME_TOLERANCE_MS,
        "The synthetic tracked identity must be older than the live harness-owned process.",
      );
      assert.notEqual(
        replacementBeforeRefusal.parentPid,
        testProcessEvent.processId,
        "The replacement process must belong to the external harness, not the nested runner.",
      );

      await writeFile(verifiedProcessTreeFile, await readFile(processTreeFile, "utf8"));
      appendWindowsProcessTreeRecord(processTreeFile, {
        event: "start",
        parentPid: testProcessEvent.processId,
        processId: replacementFixture.pid,
        startedAtMs: staleStartedAtMs,
        source: "pid-reuse-regression",
      });
      await assert.rejects(
        inspectWindowsProcessTree({
          rootPid: testProcessEvent.processId,
          rootStartedAtMs: testProcessEvent.processStartedAtMs,
          processTreeFile,
        }),
        new RegExp(
          `Could not verify the identity of Windows process ${replacementFixture.pid}; cleanup is unsafe\\.`,
        ),
        "The live replacement PID must fail the identity check before shutdown is requested.",
      );

      await new Promise((resolve, reject) => {
        runner.send(
          { type: "interrupt-regression-signal", signal: "SIGINT" },
          (error) => error ? reject(error) : resolve(),
        );
      });
      const interrupted = await waitForEvent("interrupt-regression-signal-received");
      assert.equal(interrupted.signal, "SIGINT");
      const refusedStop = await waitForEvent("windows-process-tree-stop-refused");
      assert.equal(refusedStop.processId, testProcessEvent.processId);
      assert.ok(
        refusedStop.message.includes(`Windows process ${replacementFixture.pid}`),
        "The runner must report why it refused to stop the tracked process tree.",
      );

      const replacementAfterRefusal = await waitForWindowsProcessInfo(replacementFixture.pid);
      assert.equal(
        replacementAfterRefusal.creationTimeMs,
        replacementBeforeRefusal.creationTimeMs,
        "The same harness-owned process must remain live after the runner refuses shutdown.",
      );
      assert.equal(replacementFixture.exitCode, null);
      assert.equal(replacementFixture.signalCode, null);

      await stopWindowsProcessTree({
        rootPid: testProcessEvent.processId,
        rootStartedAtMs: testProcessEvent.processStartedAtMs,
        processTreeFile: verifiedProcessTreeFile,
        initialSignal: "SIGTERM",
        graceMs: shutdownGraceMs,
        forceWaitMs: shutdownForceWaitMs,
      });
      const stoppedRunner = await waitForPromiseOrTimeout(runnerClosed, 30_000);
      assert.ok(stoppedRunner, `The nested API runner did not finish: ${runnerOutput}`);
      assert.equal(stoppedRunner.signal, null);
      assert.notEqual(stoppedRunner.code, 0, "The runner must report the refused unsafe shutdown.");
    } finally {
      if (replacementFixture) {
        await stopOwnedFixture(replacementFixture, replacementClosed);
      }
      if (runner && runner.exitCode === null && runner.signalCode === null) {
        if (testProcessEvent && await readFile(verifiedProcessTreeFile, "utf8").then(() => true, () => false)) {
          await stopWindowsProcessTree({
            rootPid: testProcessEvent.processId,
            rootStartedAtMs: testProcessEvent.processStartedAtMs,
            processTreeFile: verifiedProcessTreeFile,
            initialSignal: "SIGTERM",
            graceMs: shutdownGraceMs,
            forceWaitMs: shutdownForceWaitMs,
          }).catch(() => {});
        } else if (runner.connected) {
          await new Promise((resolve) => {
            runner.send(
              { type: "interrupt-regression-signal", signal: "SIGTERM" },
              () => resolve(),
            );
          });
        }
        const stoppedRunner = await waitForPromiseOrTimeout(runnerClosed, 30_000);
        assert.ok(stoppedRunner, `The nested API runner did not finish during test cleanup: ${runnerOutput}`);
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  },
);
