import type { IdleTestResult, MemorySample, RiskAssessment, RiskLevel, VmmapDiffRow } from "../types/domain.ts";
import { bytesOrZero, clamp } from "../utils/format.ts";

interface RiskOptions {
  idleTest?: IdleTestResult | null;
  vmmapDiff?: VmmapDiffRow[];
}

export function analyzeRisk(series: MemorySample[], options: RiskOptions = {}): RiskAssessment {
  if (series.length < 2) {
    return {
      score: 12,
      level: "normal",
      verdict: "Collecting baseline",
      confidence: 32,
      reasons: ["Need a few more samples before the trend is meaningful."],
      suggestedActions: ["Keep sampling for a couple of minutes.", "Capture a vmmap snapshot once the shape stabilizes."],
      metrics: {
        residentDelta5m: 0,
        residentDelta15m: 0,
        residentDelta1h: 0,
        privateDelta15m: 0,
        compressedDelta15m: 0,
        swapDelta15m: 0,
        childRunaway: false,
        dominantChildName: null,
        recoveryRatio: options.idleTest?.recoveryRatio ?? null,
        steadyGrowth: false,
        repeatedRegions: [],
      },
    };
  }

  const residentDelta5m = deltaForWindow(series, 5 * 60_000, (sample) => sample.residentBytes);
  const residentDelta15m = deltaForWindow(series, 15 * 60_000, (sample) => sample.residentBytes);
  const residentDelta1h = deltaForWindow(series, 60 * 60_000, (sample) => sample.residentBytes);
  const privateDelta15mValue = deltaForNullableWindow(series, 15 * 60_000, (sample) => sample.privateBytes);
  const privateDelta15m = privateDelta15mValue ?? 0;
  const compressedDelta15m = deltaForWindow(series, 15 * 60_000, (sample) => bytesOrZero(sample.compressedBytes));
  const swapDelta15m = deltaForWindow(series, 15 * 60_000, (sample) => bytesOrZero(sample.swapUsedBytes));
  const steadyGrowth = monotonicGrowth(series, 15 * 60_000, (sample) => sample.residentBytes);
  const childRunaway = detectChildRunaway(series, 15 * 60_000);
  const primaryWindowLabel = describeSeriesWindow(series, 15 * 60_000);
  const repeatedRegions = (options.vmmapDiff ?? [])
    .filter((row) => row.deltaBytes >= 64 * 1024 ** 2)
    .slice(0, 3)
    .map((row) => `${row.name} ${row.metric}`);

  const reasons: string[] = [];
  const suggestedActions = new Set<string>();
  let score = 0;

  if (privateDelta15mValue !== null && privateDelta15m >= 512 * 1024 ** 2) {
    score += 26;
    reasons.push(`Private memory is rising quickly ${primaryWindowLabel}.`);
    suggestedActions.add("Capture a vmmap diff after reproducing the growth trigger.");
  } else if (privateDelta15mValue !== null && privateDelta15m >= 192 * 1024 ** 2) {
    score += 16;
    reasons.push(`Private memory is trending upward ${primaryWindowLabel}.`);
  } else if (privateDelta15mValue !== null && privateDelta15m >= 96 * 1024 ** 2) {
    score += 8;
    reasons.push("Private memory has a noticeable upward drift.");
  } else if (privateDelta15mValue === null) {
    suggestedActions.add("Use vmmap snapshots for dirty/private region confirmation; live ps samples do not expose exact private bytes.");
  }

  if (residentDelta15m >= 768 * 1024 ** 2) {
    score += 20;
    reasons.push("Resident memory is expanding aggressively.");
  } else if (residentDelta15m >= 256 * 1024 ** 2) {
    score += 12;
    reasons.push("Resident memory has grown materially in the active window.");
  }

  if (compressedDelta15m >= 128 * 1024 ** 2) {
    reasons.push(
      `System compressed memory also rose ${primaryWindowLabel}; treat this as host pressure context, not target-local leak evidence.`,
    );
    suggestedActions.add("Repeat the capture with quieter system load or compare against a control process.");
  }

  if (swapDelta15m >= 128 * 1024 ** 2) {
    reasons.push(
      `System swap usage increased ${primaryWindowLabel}; this confirms host pressure but not which process caused it.`,
    );
    suggestedActions.add("Export a report while swap impact is visible, but attribute leaks using target RSS and vmmap diffs.");
  }

  if (steadyGrowth) {
    score += 10;
    reasons.push("The growth pattern looks steady rather than bursty.");
  }

  if (childRunaway.deltaBytes >= 128 * 1024 ** 2) {
    score += 18;
    reasons.push(
      childRunaway.name
        ? `${childRunaway.name} (${childRunaway.pid}) is growing faster than the rest of the process group.`
        : "A child process is growing faster than the parent group.",
    );
    suggestedActions.add("Inspect the fastest-growing child process separately.");
  }

  if (options.idleTest?.outcome === "not_recovered") {
    score += 20;
    reasons.push("The target did not recover meaningfully during the idle test.");
    suggestedActions.add("Repeat the idle test after capturing a snapshot baseline.");
  } else if (options.idleTest?.outcome === "recovered") {
    score = Math.max(0, score - 8);
  }

  if (repeatedRegions.length > 0) {
    score += Math.min(18, repeatedRegions.length * 6);
    reasons.push(`The same vmmap regions keep growing: ${repeatedRegions.join(", ")}.`);
    suggestedActions.add("Capture a second vmmap diff after the exact same interaction.");
  }

  score = clamp(score, 0, 100);
  const level = scoreToLevel(score);
  const verdict = verdictFor(level, childRunaway.deltaBytes > 0);

  suggestedActions.add("Keep claims careful: this is suspicious growth, not proof of a confirmed leak.");
  if (score >= 60) {
    suggestedActions.add("Export a markdown report and attach it to the bug or support thread.");
  }

  const confidence = clamp(
    Math.round(
      36 +
        Math.min(24, series.length * 2) +
        reasons.length * 7 +
        (options.vmmapDiff?.length ? 6 : 0) +
        (options.idleTest?.outcome === "pending" ? 0 : 6),
    ),
    28,
    96,
  );

  return {
    score,
    level,
    verdict,
    confidence,
    reasons,
    suggestedActions: [...suggestedActions],
    metrics: {
      residentDelta5m,
      residentDelta15m,
      residentDelta1h,
      privateDelta15m,
      compressedDelta15m,
      swapDelta15m,
      childRunaway: childRunaway.deltaBytes > 0,
      dominantChildName: childRunaway.name,
      recoveryRatio: options.idleTest?.recoveryRatio ?? null,
      steadyGrowth,
      repeatedRegions,
    },
  };
}

function deltaForWindow(
  series: MemorySample[],
  windowMs: number,
  accessor: (sample: MemorySample) => number,
): number {
  const latest = series.at(-1);
  if (!latest) {
    return 0;
  }

  const threshold = latest.capturedAt - windowMs;
  const baseline = series.find((sample) => sample.capturedAt >= threshold) ?? series[0];
  if (!baseline) {
    return 0;
  }

  return accessor(latest) - accessor(baseline);
}

function deltaForNullableWindow(
  series: MemorySample[],
  windowMs: number,
  accessor: (sample: MemorySample) => number | null | undefined,
): number | null {
  const latest = series.at(-1);
  if (!latest) {
    return null;
  }

  const threshold = latest.capturedAt - windowMs;
  const baseline = series.find((sample) => sample.capturedAt >= threshold) ?? series[0];
  if (!baseline) {
    return null;
  }

  const latestValue = accessor(latest);
  const baselineValue = accessor(baseline);
  if (latestValue === null || latestValue === undefined || baselineValue === null || baselineValue === undefined) {
    return null;
  }

  return latestValue - baselineValue;
}

function describeSeriesWindow(series: MemorySample[], requestedWindowMs: number): string {
  const first = series[0];
  const latest = series.at(-1);
  if (!first || !latest) {
    return "over the sampled window";
  }

  const actualWindowMs = latest.capturedAt - first.capturedAt;
  if (actualWindowMs >= requestedWindowMs * 0.9) {
    return "over the last 15 minutes";
  }

  return `over the ${formatShortDuration(actualWindowMs)} sample`;
}

function formatShortDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function monotonicGrowth(
  series: MemorySample[],
  windowMs: number,
  accessor: (sample: MemorySample) => number,
): boolean {
  const latest = series.at(-1);
  if (!latest) {
    return false;
  }

  const threshold = latest.capturedAt - windowMs;
  const relevant = series.filter((sample) => sample.capturedAt >= threshold);
  if (relevant.length < 4) {
    return false;
  }

  let upwardSteps = 0;
  let totalSteps = 0;
  for (let index = 1; index < relevant.length; index += 1) {
    const previous = relevant[index - 1];
    const current = relevant[index];
    if (!previous || !current) {
      continue;
    }

    totalSteps += 1;
    if (accessor(current) >= accessor(previous)) {
      upwardSteps += 1;
    }
  }

  return totalSteps > 0 && upwardSteps / totalSteps >= 0.7;
}

function detectChildRunaway(
  series: MemorySample[],
  windowMs: number,
): { name: string | null; pid: number | null; deltaBytes: number } {
  const latest = series.at(-1);
  if (!latest) {
    return { name: null, pid: null, deltaBytes: 0 };
  }

  const threshold = latest.capturedAt - windowMs;
  const baseline = series.find((sample) => sample.capturedAt >= threshold) ?? series[0];
  if (!baseline) {
    return { name: null, pid: null, deltaBytes: 0 };
  }

  const before = new Map(baseline.childSummaries.map((child) => [child.pid, child.rssBytes]));

  let dominantName: string | null = null;
  let dominantPid: number | null = null;
  let dominantDelta = 0;

  for (const child of latest.childSummaries) {
    const beforeBytes = before.get(child.pid);
    if (beforeBytes === undefined) {
      continue;
    }

    const delta = child.rssBytes - beforeBytes;
    if (delta > dominantDelta) {
      dominantDelta = delta;
      dominantName = child.name;
      dominantPid = child.pid;
    }
  }

  return { name: dominantName, pid: dominantPid, deltaBytes: dominantDelta };
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

function verdictFor(level: RiskLevel, childRunaway: boolean): string {
  if (level === "high" && childRunaway) {
    return "Child process runaway";
  }
  if (level === "high") {
    return "Possible leak pattern";
  }
  if (level === "suspicious") {
    return "Suspicious growth";
  }
  if (level === "watch") {
    return "Elevated";
  }
  return "Normal";
}
