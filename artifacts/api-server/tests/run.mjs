import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address();
const port = typeof address === "object" && address ? address.port : 0;
await new Promise((resolve) => probe.close(resolve));
const testMediaStorageDir = await mkdtemp(path.join(os.tmpdir(), "sitecheck-media-storage-"));

const server = spawn(
  process.execPath,
  ["--enable-source-maps", "./dist/index.mjs"],
  {
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
server.stdout.on("data", (chunk) => {
  serverOutput += chunk;
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk;
});

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  if (!ready) {
    throw new Error(`Test API did not start.\n${serverOutput}`);
  }

  const tests = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      "src/lib/orphaned-finding-media-cleanup.test.ts",
      "src/routes/report-policy.test.ts",
      "tests/report-api.test.mjs",
    ],
    {
      env: {
        ...process.env,
        TEST_API_BASE_URL: baseUrl,
        TEST_MEDIA_STORAGE_DIR: testMediaStorageDir,
      },
      stdio: "inherit",
    },
  );
  const testExitCode = await new Promise((resolve) =>
    tests.on("exit", (code) => resolve(code ?? 1)),
  );
  process.exitCode = testExitCode;
} finally {
  server.kill("SIGTERM");
  await rm(testMediaStorageDir, { recursive: true, force: true });
}