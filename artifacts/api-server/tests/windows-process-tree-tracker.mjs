import { createRequire, syncBuiltinESMExports } from "node:module";
import { appendWindowsProcessTreeRecord } from "./windows-process-tree.mjs";

const processTreeFile = process.env.API_TEST_RUNNER_PROCESS_TREE_FILE;

if (processTreeFile) {
  const processStartedAtMs = Date.now();
  appendWindowsProcessTreeRecord(processTreeFile, {
    event: "start",
    parentPid: process.ppid,
    processId: process.pid,
    startedAtMs: processStartedAtMs,
    source: "node-runtime",
  });
  process.once("exit", () => {
    appendWindowsProcessTreeRecord(processTreeFile, {
      event: "exit",
      processId: process.pid,
      startedAtMs: processStartedAtMs,
      exitedAtMs: Date.now(),
      source: "node-runtime",
    });
  });

  const require = createRequire(import.meta.url);
  const childProcess = require("node:child_process");

  function trackChildProcess(child) {
    let childStartedAtMs;
    const recordStart = () => {
      if (childStartedAtMs || !Number.isSafeInteger(child.pid)) return;
      childStartedAtMs = Date.now();
      appendWindowsProcessTreeRecord(processTreeFile, {
        event: "start",
        parentPid: process.pid,
        processId: child.pid,
        startedAtMs: childStartedAtMs,
        source: "child-process",
      });
    };

    if (Number.isSafeInteger(child?.pid)) recordStart();
    else child?.once?.("spawn", recordStart);
    child?.once?.("exit", () => {
      if (!childStartedAtMs) return;
      appendWindowsProcessTreeRecord(processTreeFile, {
        event: "exit",
        processId: child.pid,
        startedAtMs: childStartedAtMs,
        exitedAtMs: Date.now(),
        source: "child-process",
      });
    });
    return child;
  }

  for (const methodName of ["spawn", "fork", "exec", "execFile"]) {
    const originalMethod = childProcess[methodName];
    if (typeof originalMethod !== "function") continue;
    childProcess[methodName] = function (...args) {
      return trackChildProcess(originalMethod.apply(this, args));
    };
  }
  syncBuiltinESMExports();
}