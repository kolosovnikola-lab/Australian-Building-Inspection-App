import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const PROCESS_START_TIME_TOLERANCE_MS = 2_000;
const WINDOWS_PROCESS_SNAPSHOT_TIMEOUT_MS = 5_000;
const WINDOWS_PROCESS_TREE_POLL_MS = 100;

export function appendWindowsProcessTreeRecord(filePath, record) {
  appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readWindowsProcessTreeRecords(filePath) {
  const contents = await readFile(filePath, "utf8");
  const records = [];

  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`The Windows process tree record at line ${index + 1} is malformed.`, { cause: error });
    }
    if (
      !record
      || !["start", "exit"].includes(record.event)
      || !Number.isSafeInteger(record.processId)
      || record.processId <= 1
      || !Number.isSafeInteger(record.startedAtMs)
      || record.startedAtMs <= 0
      || (record.event === "start" && (!Number.isSafeInteger(record.parentPid) || record.parentPid < 0))
      || (record.event === "exit" && !Number.isSafeInteger(record.exitedAtMs))
    ) {
      throw new Error(`The Windows process tree record at line ${index + 1} is invalid.`);
    }
    records.push(record);
  }

  return records;
}

export async function readWindowsProcessSnapshot() {
  if (process.platform !== "win32") {
    throw new Error("Windows process snapshots are available only on Windows.");
  }

  const powershellScript = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | ForEach-Object {",
    "  $creationTimeMs = 0L",
    "  if ($_.CreationDate) { $creationTimeMs = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }",
    "  [pscustomobject]@{ processId = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; creationTimeMs = [long]$creationTimeMs }",
    "})",
    "ConvertTo-Json -InputObject ([pscustomobject]@{ processes = $processes }) -Compress -Depth 3",
  ].join("\n");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      powershellScript,
    ],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: WINDOWS_PROCESS_SNAPSHOT_TIMEOUT_MS,
      windowsHide: true,
    },
  );

  let payload;
  try {
    payload = JSON.parse(stdout.replace(/^\uFEFF/, "").trim());
  } catch (error) {
    throw new Error("Windows process enumeration returned invalid JSON.", { cause: error });
  }
  if (!payload || !Array.isArray(payload.processes)) {
    throw new Error("Windows process enumeration returned an invalid process list.");
  }

  return payload.processes.map((processInfo) => {
    const normalized = {
      processId: Number(processInfo.processId),
      parentPid: Number(processInfo.parentPid),
      creationTimeMs: Number(processInfo.creationTimeMs),
    };
    if (
      !Number.isSafeInteger(normalized.processId)
      || normalized.processId <= 0
      || !Number.isSafeInteger(normalized.parentPid)
      || normalized.parentPid < 0
      || !Number.isSafeInteger(normalized.creationTimeMs)
      || normalized.creationTimeMs < 0
    ) {
      throw new Error("Windows process enumeration returned invalid process details.");
    }
    return normalized;
  });
}

function getWindowsTrackedDescendantRecords(records, rootPid, rootStartedAtMs) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 1 || !Number.isSafeInteger(rootStartedAtMs)) {
    throw new Error("A valid Windows root process ID and start time are required.");
  }

  const knownProcessIds = new Set([rootPid]);
  const frontier = [rootPid];
  const descendants = [];
  while (frontier.length > 0) {
    const parentPid = frontier.shift();
    for (const record of records) {
      if (
        record.event !== "start"
        || record.parentPid !== parentPid
        || record.startedAtMs < rootStartedAtMs - PROCESS_START_TIME_TOLERANCE_MS
        || record.processId === rootPid
      ) {
        continue;
      }
      descendants.push(record);
      if (!knownProcessIds.has(record.processId)) {
        knownProcessIds.add(record.processId);
        frontier.push(record.processId);
      }
    }
  }
  return descendants;
}

export function getWindowsTrackedDescendantProcessIds(records, rootPid, rootStartedAtMs) {
  return [
    ...new Set(
      getWindowsTrackedDescendantRecords(records, rootPid, rootStartedAtMs)
        .map((record) => record.processId),
    ),
  ];
}

function matchesProcessStartTime(processInfo, startTimes) {
  if (processInfo.creationTimeMs === 0) return false;
  return startTimes.some(
    (startedAtMs) => Math.abs(processInfo.creationTimeMs - startedAtMs) <= PROCESS_START_TIME_TOLERANCE_MS,
  );
}

export function inspectWindowsProcessTreeFromSnapshot({ rootPid, rootStartedAtMs, records, snapshot }) {
  const descendantRecords = getWindowsTrackedDescendantRecords(records, rootPid, rootStartedAtMs);
  const trackedDescendantProcessIds = [
    ...new Set(descendantRecords.map((record) => record.processId)),
  ];
  const snapshotByPid = new Map(snapshot.map((processInfo) => [processInfo.processId, processInfo]));
  const startTimesByPid = new Map([[rootPid, [rootStartedAtMs]]]);

  for (const record of descendantRecords) {
    const startTimes = startTimesByPid.get(record.processId) ?? [];
    startTimes.push(record.startedAtMs);
    startTimesByPid.set(record.processId, startTimes);
  }

  const knownProcessIds = new Set([rootPid, ...trackedDescendantProcessIds]);
  const frontier = [...knownProcessIds];
  const snapshotDescendantProcessIds = [];
  while (frontier.length > 0) {
    const parentPid = frontier.shift();
    for (const processInfo of snapshot) {
      if (
        processInfo.parentPid !== parentPid
        || processInfo.processId === rootPid
        || knownProcessIds.has(processInfo.processId)
      ) {
        continue;
      }
      if (processInfo.creationTimeMs === 0) {
        throw new Error(`Could not verify the start time of Windows process ${processInfo.processId}; cleanup is unsafe.`);
      }
      if (processInfo.creationTimeMs < rootStartedAtMs - PROCESS_START_TIME_TOLERANCE_MS) continue;
      knownProcessIds.add(processInfo.processId);
      snapshotDescendantProcessIds.push(processInfo.processId);
      startTimesByPid.set(processInfo.processId, [processInfo.creationTimeMs]);
      frontier.push(processInfo.processId);
    }
  }

  const isTrackedProcessLive = (processId) => {
    const processInfo = snapshotByPid.get(processId);
    if (!processInfo) return false;
    const startTimes = startTimesByPid.get(processId);
    if (!startTimes || !matchesProcessStartTime(processInfo, startTimes)) {
      throw new Error(`Could not verify the identity of Windows process ${processId}; cleanup is unsafe.`);
    }
    return true;
  };

  const liveDescendantProcessIds = [
    ...new Set([...trackedDescendantProcessIds, ...snapshotDescendantProcessIds]),
  ].filter(isTrackedProcessLive);
  const rootLive = isTrackedProcessLive(rootPid);
  return {
    trackedDescendantProcessIds: [...new Set([...trackedDescendantProcessIds, ...snapshotDescendantProcessIds])],
    liveDescendantProcessIds,
    rootLive,
  };
}

export async function inspectWindowsProcessTree({ rootPid, rootStartedAtMs, processTreeFile }) {
  const [records, snapshot] = await Promise.all([
    readWindowsProcessTreeRecords(processTreeFile),
    readWindowsProcessSnapshot(),
  ]);
  return inspectWindowsProcessTreeFromSnapshot({ rootPid, rootStartedAtMs, records, snapshot });
}

function signalWindowsProcess(processId, signal) {
  try {
    process.kill(processId, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

export async function stopWindowsProcessTree({
  rootPid,
  rootStartedAtMs,
  processTreeFile,
  initialSignal = "SIGTERM",
  graceMs,
  forceWaitMs,
  rootChild,
}) {
  const stoppedProcessIds = new Set();

  const stopWithSignal = async (signal, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const status = await inspectWindowsProcessTree({ rootPid, rootStartedAtMs, processTreeFile });
      for (const processId of status.trackedDescendantProcessIds) {
        stoppedProcessIds.add(processId);
      }
      for (const processId of [...status.liveDescendantProcessIds].reverse()) {
        signalWindowsProcess(processId, signal);
      }

      const rootChildObjectIsAlive = rootChild
        && rootChild.exitCode === null
        && rootChild.signalCode === null;
      const rootIsAlive = status.rootLive || rootChildObjectIsAlive;
      if (rootIsAlive) {
        if (rootChildObjectIsAlive) rootChild.kill(signal);
        else signalWindowsProcess(rootPid, signal);
      }
      if (!rootIsAlive && status.liveDescendantProcessIds.length === 0) return true;
      if (Date.now() >= deadline) return false;
      await delay(WINDOWS_PROCESS_TREE_POLL_MS);
    }
  };

  const firstSignal = initialSignal === "SIGINT" ? "SIGTERM" : initialSignal;
  let stopped = await stopWithSignal(firstSignal, graceMs);
  if (!stopped) stopped = await stopWithSignal("SIGKILL", forceWaitMs);
  if (!stopped) {
    throw new Error(`Windows process tree rooted at ${rootPid} remained live after shutdown.`);
  }
  return [...stoppedProcessIds];
}