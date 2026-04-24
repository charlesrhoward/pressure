import path from "node:path";
import type { CollectorSelector, ProcessEntry, ProcessGroup, RiskLevel } from "../types/domain.ts";
import { parseElapsedToSeconds, slugify } from "../utils/format.ts";
import { runCommand } from "../utils/shell.ts";

interface RawProcess extends ProcessEntry {
  ppid: number;
  bundlePath: string | null;
  bundleName: string | null;
  groupKey: string;
  groupName: string;
}

const HELPER_PATTERNS = [
  / helper(?: \([^)]+\))?$/i,
  / renderer$/i,
  / gpu$/i,
  / extension host$/i,
  / utility(?: \([^)]+\))?$/i,
  / crashpad(?: handler)?$/i,
  / plugin(?: process)?$/i,
] as const;

export async function listProcessGroups(filter?: string): Promise<ProcessGroup[]> {
  const result = runCommand("ps", ["-axo", "pid=,ppid=,pcpu=,rss=,etime=,command="]);
  if (!result.ok) {
    throw new Error(result.stderr.trim() || result.error || "Unable to list processes with ps.");
  }

  const rawProcesses = result.stdout
    .split("\n")
    .map((line) => parsePsLine(line))
    .filter((process): process is RawProcess => process !== null);

  const byPid = new Map(rawProcesses.map((process) => [process.pid, process]));

  for (const process of rawProcesses) {
    const owner = resolveOwningProcess(process, byPid);
    process.groupKey = buildOwnerKey(owner);
    process.groupName = owner.bundleName ?? owner.name;
  }

  const groupsById = new Map<string, RawProcess[]>();
  for (const process of rawProcesses) {
    const bucket = groupsById.get(process.groupKey) ?? [];
    bucket.push(process);
    groupsById.set(process.groupKey, bucket);
  }

  const groups = [...groupsById.entries()]
    .map(([groupKey, processes]) => buildProcessGroup(groupKey, processes))
    .filter((group) => matchFilter(group, filter))
    .sort((left, right) => right.totalRssBytes - left.totalRssBytes);

  return groups;
}

export function resolveTargetGroup(groups: ProcessGroup[], selector: CollectorSelector): ProcessGroup | null {
  if (selector.groupId) {
    return groups.find((group) => group.id === selector.groupId) ?? null;
  }

  if (selector.pid !== undefined) {
    return (
      groups.find((group) => group.pid === selector.pid || group.children.some((child) => child.pid === selector.pid)) ?? null
    );
  }

  if (selector.appName) {
    const normalized = normalize(selector.appName);
    return groups.find((group) => normalize(group.displayName).includes(normalized)) ?? null;
  }

  return null;
}

export function resolveTargetProcess(group: ProcessGroup, pid?: number): ProcessEntry | null {
  if (pid === undefined || pid === group.rootProcess.pid) {
    return group.rootProcess;
  }

  return group.children.find((child) => child.pid === pid) ?? null;
}

function buildProcessGroup(groupKey: string, processes: RawProcess[]): ProcessGroup {
  const pidSet = new Set(processes.map((process) => process.pid));
  const root =
    processes.find((process) => !pidSet.has(process.ppid) && (process.bundlePath || !isLikelyHelper(process.name))) ??
    processes.find((process) => !isLikelyHelper(process.name)) ??
    processes[0];

  if (!root) {
    throw new Error(`Unable to derive root process for group ${groupKey}.`);
  }

  const children = processes
    .filter((process) => process.pid !== root.pid)
    .sort((left, right) => right.rssBytes - left.rssBytes)
    .map(toProcessEntry);

  const totalRssBytes = processes.reduce((sum, process) => sum + process.rssBytes, 0);
  const privateByteValues = processes.map((process) => process.privateBytes);
  const totalPrivateBytes = privateByteValues.every((value) => value !== null)
    ? privateByteValues.reduce((sum, value) => sum + (value ?? 0), 0)
    : null;

  return {
    id: buildGroupId(root, groupKey),
    displayName: root.groupName || root.bundleName || root.name,
    pid: root.pid,
    ppid: root.ppid,
    command: root.command,
    path: root.command.startsWith("/") ? root.command : null,
    rootProcess: toProcessEntry(root),
    cpuPercent: roundOne(processes.reduce((sum, process) => sum + process.cpuPercent, 0)),
    runtimeSeconds: Math.max(...processes.map((process) => process.runtimeSeconds)),
    rssBytes: root.rssBytes,
    privateBytes: root.privateBytes,
    totalRssBytes,
    totalPrivateBytes,
    childCount: children.length,
    children,
    riskHint: deriveRiskHint(totalRssBytes, children, root.rssBytes),
  };
}

function toProcessEntry(process: RawProcess): ProcessEntry {
  return {
    pid: process.pid,
    name: process.name,
    rssBytes: process.rssBytes,
    privateBytes: process.privateBytes,
    cpuPercent: process.cpuPercent,
    runtimeSeconds: process.runtimeSeconds,
    command: process.command,
  };
}

function parsePsLine(line: string): RawProcess | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d+)\s+(\d+)\s+([0-9.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
  if (!match) {
    return null;
  }

  const [, pidText, ppidText, cpuText, rssText, elapsedText, commandText] = match;
  if (!pidText || !ppidText || !cpuText || !rssText || !elapsedText || !commandText) {
    return null;
  }

  const pid = Number(pidText);
  const ppid = Number(ppidText);
  const cpuPercent = Number(cpuText);
  const rssKilobytes = Number(rssText);
  const runtimeSeconds = parseElapsedToSeconds(elapsedText);
  const command = commandText.trim();

  const bundlePath = extractBundlePath(command);
  const bundleName = bundlePath ? path.basename(bundlePath, ".app") : null;
  const name = deriveDisplayName(command, bundleName);
  const groupName = deriveGroupName(name, bundleName);

  return {
    pid,
    ppid,
    cpuPercent,
    rssBytes: rssKilobytes * 1024,
    privateBytes: null,
    runtimeSeconds,
    command,
    name,
    bundlePath,
    bundleName,
    groupKey: `pid:${pid}`,
    groupName,
  };
}

function extractBundlePath(command: string): string | null {
  const bundleMatch = command.match(/(\/.*?\.app)(?:\/|\s|$)/i);
  return bundleMatch?.[1] ?? null;
}

function deriveDisplayName(command: string, bundleName: string | null): string {
  if (bundleName) {
    return bundleName;
  }

  const executable = path.basename(command.split(/\s+/)[0] ?? command);
  return executable.replace(/\.app$/i, "");
}

function deriveGroupName(name: string, bundleName: string | null): string {
  if (bundleName) {
    return bundleName;
  }

  let groupName = name;
  for (const pattern of HELPER_PATTERNS) {
    groupName = groupName.replace(pattern, "");
  }

  return groupName.trim() || name;
}

function isLikelyHelper(name: string): boolean {
  return HELPER_PATTERNS.some((pattern) => pattern.test(name));
}

function resolveOwningProcess(process: RawProcess, byPid: Map<number, RawProcess>): RawProcess {
  if (process.bundlePath) {
    return process;
  }

  let cursor = byPid.get(process.ppid) ?? null;
  while (cursor) {
    if (cursor.bundlePath) {
      return cursor;
    }

    if (isLikelyHelper(process.name)) {
      if (!isLikelyHelper(cursor.name)) {
        return cursor;
      }
    } else if (!isLikelyHelper(cursor.name) && cursor.ppid === 1) {
      return process;
    }

    cursor = byPid.get(cursor.ppid) ?? null;
  }

  return process;
}

function buildOwnerKey(owner: RawProcess): string {
  if (owner.bundlePath) {
    return `bundle:${owner.bundlePath.toLowerCase()}`;
  }

  return `pid:${owner.pid}`;
}

function buildGroupId(root: RawProcess, groupKey: string): string {
  return slugify(root.bundlePath ?? `${groupKey}-${root.groupName || root.name || root.pid}`);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchFilter(group: ProcessGroup, filter?: string): boolean {
  if (!filter) {
    return true;
  }

  const normalized = normalize(filter);
  return (
    normalize(group.displayName).includes(normalized) ||
    normalize(group.command).includes(normalized) ||
    group.children.some((child) => normalize(child.name).includes(normalized))
  );
}

function deriveRiskHint(totalRssBytes: number, children: ProcessEntry[], rootRssBytes: number): RiskLevel {
  const helperShare = totalRssBytes > 0 ? children.reduce((sum, child) => sum + child.rssBytes, 0) / totalRssBytes : 0;

  if (totalRssBytes >= 4 * 1024 ** 3 || helperShare >= 0.7) {
    return "high";
  }
  if (totalRssBytes >= 2 * 1024 ** 3 || helperShare >= 0.55) {
    return "suspicious";
  }
  if (totalRssBytes >= 1 * 1024 ** 3 || rootRssBytes >= 768 * 1024 ** 2) {
    return "watch";
  }
  return "normal";
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
