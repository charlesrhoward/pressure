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
      residentBytes: 0,
      dirtyBytes: 0,
      swapBytes: 0,
    };

    current.virtualBytes += virtualBytes;
    current.residentBytes = (current.residentBytes ?? 0) + (residentBytes ?? 0);
    current.dirtyBytes = (current.dirtyBytes ?? 0) + (dirtyBytes ?? 0);
    current.swapBytes = (current.swapBytes ?? 0) + (swapBytes ?? 0);
    regions.set(name, current);
  }

  return [...regions.values()].sort((left, right) => right.virtualBytes - left.virtualBytes);
}

export function diffVmmapSnapshots(before: VmmapSnapshot, after: VmmapSnapshot): VmmapDiffRow[] {
  const beforeMap = new Map(before.regions.map((region) => [region.name, region]));
  const afterMap = new Map(after.regions.map((region) => [region.name, region]));
  const names = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);

  return [...names]
    .map((name) => {
      const previous = beforeMap.get(name);
      const next = afterMap.get(name);
      const beforeBytes = previous?.virtualBytes ?? 0;
      const afterBytes = next?.virtualBytes ?? 0;
      const deltaBytes = afterBytes - beforeBytes;

      return {
        name,
        beforeBytes,
        afterBytes,
        deltaBytes,
        trend: trendFromDelta(deltaBytes),
      };
    })
    .filter((row) => row.beforeBytes !== 0 || row.afterBytes !== 0)
    .sort((left, right) => Math.abs(right.deltaBytes) - Math.abs(left.deltaBytes));
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
