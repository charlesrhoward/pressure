import type { VmmapDiffRow, VmmapRegionSummary, VmmapSnapshot } from "../types/domain.ts";
import { formatTrend, humanSizeToBytes } from "../utils/format.ts";
import { runCommand } from "../utils/shell.ts";

const BRACKET_REGION_PATTERN =
  /^\s*([A-Za-z0-9_./:+() -]+?)\s+(?:\([^)]*\)\s+)?(?:[0-9A-Fa-f]+\s*-\s*[0-9A-Fa-f]+\s+)?\[\s*([\d.]+\s*[KMGTP]?B?)\s+([\d.]+\s*[KMGTP]?B?)\s+([\d.]+\s*[KMGTP]?B?)\s+([\d.]+\s*[KMGTP]?B?)\]/;

const SIMPLE_REGION_PATTERN =
  /^\s*([A-Za-z0-9_./:+() -]+?)\s{2,}([\d.]+\s*[KMGTP]?B?)\s{2,}([\d.]+\s*[KMGTP]?B?)(?:\s{2,}([\d.]+\s*[KMGTP]?B?))?(?:\s{2,}([\d.]+\s*[KMGTP]?B?))?$/;

export async function captureVmmapSnapshot(
  pid: number,
  targetName: string,
  command: string | null = null,
): Promise<VmmapSnapshot> {
  const primary = runCommand("vmmap", [String(pid), "--summary"]);
  const fallback = primary.ok ? primary : runCommand("vmmap", [String(pid)]);
  if (!fallback.ok) {
    throw new Error(fallback.stderr.trim() || fallback.error || "vmmap failed.");
  }

  return {
    pid,
    targetName,
    capturedAt: Date.now(),
    command,
    raw: fallback.stdout,
    regions: parseVmmapRegions(fallback.stdout),
  };
}

export function parseVmmapRegions(raw: string): VmmapRegionSummary[] {
  const regions = new Map<string, VmmapRegionSummary>();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("====") || trimmed.startsWith("REGION TYPE")) {
      continue;
    }

    const bracketMatch = line.match(BRACKET_REGION_PATTERN);
    const simpleMatch = line.match(SIMPLE_REGION_PATTERN);
    const match = bracketMatch ?? simpleMatch;
    if (!match) {
      continue;
    }

    const [, nameText, virtualText, residentText, dirtyText, swapText] = match;
    if (!nameText || !virtualText || !residentText) {
      continue;
    }

    const name = nameText.trim();
    const virtualBytes = humanSizeToBytes(virtualText) ?? 0;
    const residentBytes = humanSizeToBytes(residentText);
    const dirtyBytes = humanSizeToBytes(dirtyText);
    const swapBytes = humanSizeToBytes(swapText);

    const current: VmmapRegionSummary = regions.get(name) ?? {
      name,
      virtualBytes: 0,
      residentBytes: null,
      dirtyBytes: null,
      swapBytes: null,
    };

    current.virtualBytes += virtualBytes;
    current.residentBytes = addOptionalBytes(current.residentBytes, residentBytes);
    current.dirtyBytes = addOptionalBytes(current.dirtyBytes, dirtyBytes);
    current.swapBytes = addOptionalBytes(current.swapBytes, swapBytes);
    regions.set(name, current);
  }

  return [...regions.values()].sort((left, right) => rankRegionBytes(right) - rankRegionBytes(left));
}

export function diffVmmapSnapshots(before: VmmapSnapshot, after: VmmapSnapshot): VmmapDiffRow[] {
  const beforeMap = new Map(before.regions.map((region) => [region.name, region]));
  const afterMap = new Map(after.regions.map((region) => [region.name, region]));
  const names = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);

  return [...names]
    .map((name) => {
      const previous = beforeMap.get(name);
      const next = afterMap.get(name);
      const metric = chooseDiffMetric(previous, next);
      const beforeBytes = bytesForMetric(previous, metric);
      const afterBytes = bytesForMetric(next, metric);
      const deltaBytes = afterBytes - beforeBytes;

      return {
        name,
        metric,
        beforeBytes,
        afterBytes,
        deltaBytes,
        trend: trendFromDelta(deltaBytes),
      };
    })
    .filter((row) => row.beforeBytes !== 0 || row.afterBytes !== 0)
    .sort((left, right) => Math.abs(right.deltaBytes) - Math.abs(left.deltaBytes));
}

function addOptionalBytes(current: number | null, next: number | null): number | null {
  if (next === null) {
    return current;
  }

  return (current ?? 0) + next;
}

function rankRegionBytes(region: VmmapRegionSummary): number {
  return region.dirtyBytes ?? region.residentBytes ?? region.virtualBytes;
}

function chooseDiffMetric(
  previous: VmmapRegionSummary | undefined,
  next: VmmapRegionSummary | undefined,
): VmmapDiffRow["metric"] {
  const beforeDirtyBytes = previous?.dirtyBytes ?? 0;
  const afterDirtyBytes = next?.dirtyBytes ?? 0;
  const hasDirtyBytes = previous?.dirtyBytes !== null && previous?.dirtyBytes !== undefined;
  const nextHasDirtyBytes = next?.dirtyBytes !== null && next?.dirtyBytes !== undefined;
  if (hasDirtyBytes || nextHasDirtyBytes) {
    if (beforeDirtyBytes !== 0 || afterDirtyBytes !== 0) {
      return "dirty";
    }
  }

  const beforeResidentBytes = previous?.residentBytes ?? 0;
  const afterResidentBytes = next?.residentBytes ?? 0;
  const hasResidentBytes = previous?.residentBytes !== null && previous?.residentBytes !== undefined;
  const nextHasResidentBytes = next?.residentBytes !== null && next?.residentBytes !== undefined;
  if (hasResidentBytes || nextHasResidentBytes) {
    if (beforeResidentBytes !== 0 || afterResidentBytes !== 0) {
      return "resident";
    }
  }

  return "virtual";
}

function bytesForMetric(region: VmmapRegionSummary | undefined, metric: VmmapDiffRow["metric"]): number {
  if (!region) {
    return 0;
  }

  switch (metric) {
    case "dirty":
      return region.dirtyBytes ?? 0;
    case "resident":
      return region.residentBytes ?? 0;
    case "virtual":
      return region.virtualBytes;
  }
}

function trendFromDelta(deltaBytes: number): VmmapDiffRow["trend"] {
  const symbol = formatTrend(deltaBytes);
  if (symbol === "↑") {
    return "rising";
  }
  if (symbol === "↓") {
    return "falling";
  }
  return "stable";
}
