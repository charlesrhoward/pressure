import type { CollectorSampleResult, CollectorSelector, MemorySample, RiskLevel, SystemMemoryStats } from "../types/domain.ts";
import { bytesOrZero } from "../utils/format.ts";
import { runCommand } from "../utils/shell.ts";
import { listProcessGroups, resolveTargetGroup } from "./processes.ts";

export async function collectProcessMemorySample(selector: CollectorSelector): Promise<CollectorSampleResult> {
  const groups = await listProcessGroups(selector.search);
  const target = resolveTargetGroup(groups, selector);
  const system = await collectSystemMemoryStats();

  if (!target) {
    return {
      groups,
      target: null,
      sample: null,
    };
  }

  const sample: MemorySample = {
    capturedAt: Date.now(),
    groupId: target.id,
    targetName: target.displayName,
    pid: target.pid,
    rootSummary: { ...target.rootProcess },
    residentBytes: target.totalRssBytes,
    privateBytes: target.totalPrivateBytes,
    cpuPercent: target.cpuPercent,
    runtimeSeconds: target.runtimeSeconds,
    compressedBytes: system.compressedBytes,
    swapUsedBytes: system.swapUsedBytes,
    system,
    childSummaries: target.children,
  };

  return {
    groups,
    target,
    sample,
  };
}

export async function collectSystemMemoryStats(): Promise<SystemMemoryStats> {
  const capturedAt = Date.now();
  const vmStat = runCommand("vm_stat", []);
  const totalMemory = runCommand("sysctl", ["-n", "hw.memsize"]);
  const swapUsage = runCommand("sysctl", ["-n", "vm.swapusage"]);

  const pageSize = vmStat.ok ? Number(vmStat.stdout.match(/page size of (\d+) bytes/i)?.[1] ?? 0) : 0;
  const freePages = getVmStatValue(vmStat.stdout, "Pages free");
  const activePages = getVmStatValue(vmStat.stdout, "Pages active");
  const inactivePages = getVmStatValue(vmStat.stdout, "Pages inactive");
  const wiredPages = getVmStatValue(vmStat.stdout, "Pages wired down");
  const compressedStoredPages = getVmStatValue(vmStat.stdout, "Pages stored in compressor");
  const compressedOccupiedPages = getVmStatValue(vmStat.stdout, "Pages occupied by compressor");

  const totalBytes = totalMemory.ok ? Number(totalMemory.stdout.trim()) : null;
  const freeBytes = pageSize > 0 && freePages !== null ? freePages * pageSize : null;
  const activeBytes = pageSize > 0 && activePages !== null ? activePages * pageSize : null;
  const inactiveBytes = pageSize > 0 && inactivePages !== null ? inactivePages * pageSize : null;
  const wiredBytes = pageSize > 0 && wiredPages !== null ? wiredPages * pageSize : null;
  const compressedStoreBytes = pageSize > 0 && compressedStoredPages !== null ? compressedStoredPages * pageSize : null;
  const compressedBytes = pageSize > 0 && compressedOccupiedPages !== null ? compressedOccupiedPages * pageSize : null;

  const swapTotalBytes = parseSwapStat(swapUsage.stdout, "total");
  const swapUsedBytes = parseSwapStat(swapUsage.stdout, "used");
  const pressureScore = calculatePressureScore({
    totalBytes,
    freeBytes,
    compressedBytes,
    swapUsedBytes,
  });

  return {
    capturedAt,
    totalBytes,
    freeBytes,
    activeBytes,
    inactiveBytes,
    wiredBytes,
    compressedBytes,
    compressedStoreBytes,
    swapUsedBytes,
    swapTotalBytes,
    pressureScore,
    pressureLevel: scoreToLevel(pressureScore),
  };
}

function getVmStatValue(stdout: string, label: string): number | null {
  const pattern = new RegExp(`${escapeRegExp(label)}:\\s+([\\d,]+)\\.`, "i");
  const match = stdout.match(pattern);
  if (!match) {
    return null;
  }

  const [, rawValue] = match;
  if (!rawValue) {
    return null;
  }

  return Number(rawValue.replaceAll(",", ""));
}

function parseSwapStat(stdout: string, label: "total" | "used" | "free"): number | null {
  const match = stdout.match(new RegExp(`${label}\\s*=\\s*([^\\s]+)`, "i"));
  if (!match) {
    return null;
  }

  const [, rawToken] = match;
  if (!rawToken) {
    return null;
  }

  const token = rawToken.replaceAll(/\s+/g, "").toUpperCase();
  const sizeMatch = token.match(/^(\d+(?:\.\d+)?)([KMGTP])$/);
  if (!sizeMatch) {
    return null;
  }

  const [, amountText, unit] = sizeMatch;
  if (!amountText || !unit) {
    return null;
  }

  const amount = Number(amountText);
  const power = ["K", "M", "G", "T", "P"].indexOf(unit) + 1;
  return Math.round(amount * 1024 ** power);
}

function calculatePressureScore(input: {
  totalBytes: number | null;
  freeBytes: number | null;
  compressedBytes: number | null;
  swapUsedBytes: number | null;
}): number {
  const { totalBytes, freeBytes, compressedBytes, swapUsedBytes } = input;
  let score = 0;

  if (totalBytes && freeBytes !== null) {
    const freeRatio = freeBytes / totalBytes;
    if (freeRatio < 0.04) {
      score += 35;
    } else if (freeRatio < 0.08) {
      score += 22;
    } else if (freeRatio < 0.12) {
      score += 10;
    }
  }

  if (totalBytes && compressedBytes !== null) {
    const compressedRatio = compressedBytes / totalBytes;
    if (compressedRatio > 0.08) {
      score += 25;
    } else if (compressedRatio > 0.04) {
      score += 14;
    }
  }

  if (totalBytes && swapUsedBytes !== null) {
    const swapRatio = swapUsedBytes / totalBytes;
    if (swapRatio > 0.05) {
      score += 30;
    } else if (swapRatio > 0.02) {
      score += 16;
    } else if (swapRatio > 0.005) {
      score += 8;
    }
  }

  return Math.min(100, score);
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 81) {
    return "high";
  }
  if (score >= 61) {
    return "suspicious";
  }
  if (score >= 31) {
    return "watch";
  }
  return "normal";
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildAggregatePressureBytes(stats: SystemMemoryStats): number {
  return bytesOrZero(stats.compressedBytes) + bytesOrZero(stats.swapUsedBytes);
}
