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
  const privateDelta15m = deltaForWindow(series, 15 * 60_000, (sample) => bytesOrZero(sample.privateBytes));
  const compressedDelta15m = deltaForWindow(series, 15 * 60_000, (sample) => bytesOrZero(sample.compressedBytes));
  const swapDelta15m = deltaForWindow(series, 15 * 60_000, (sample) => bytesOrZero(sample.swapUsedBytes));
  const steadyGrowth = monotonicGrowth(series, 15 * 60_000, (sample) => sample.residentBytes);
  const childRunaway = detectChildRunaway(series, 15 * 60_000);
  const repeatedRegions = (options.vmmapDiff ?? [])
    .filter((row) => row.deltaBytes >= 64 * 1024 ** 2)
    .slice(0, 3)
    .map((row) => row.name);

  const reasons: string[] = [];
  const suggestedActions = new Set<string>();
  let score = 0;

  if (privateDelta15m >= 512 * 1024 ** 2) {
    score += 26;
    reasons.push("Private memory is rising quickly over the last 15 minutes.");
    suggestedActions.add("Capture a vmmap diff after reproducing the growth trigger.");
  } else if (privateDelta15m >= 192 * 1024 ** 2) {
    score += 16;
    reasons.push("Private memory is trending upward over the last 15 minutes.");
  } else if (privateDelta15m >= 96 * 1024 ** 2) {
    score += 8;
    reasons.push("Private memory has a noticeable upward drift.");
  }

  if (residentDelta15m >= 768 * 1024 ** 2) {
    score += 20;
    reasons.push("Resident memory is expanding aggressively.");
  } else if (residentDelta15m >= 256 * 1024 ** 2) {
    score += 12;
    reasons.push("Resident memory has grown materially in the active window.");
  }

  if (compressedDelta15m >= 128 * 1024 ** 2) {
    score += 12;
    reasons.push("Compressed memory is climbing alongside the target.");
    suggestedActions.add("Watch whether the memory footprint recovers after an idle period.");
  }

  if (swapDelta15m >= 128 * 1024 ** 2) {
    score += 18;
    reasons.push("Swap usage is increasing, which points to real system pressure.");
    suggestedActions.add("Export a report while swap impact is still visible.");
  }

  if (steadyGrowth) {
    score += 10;
    reasons.push("The growth pattern looks steady rather than bursty.");
  }

  if (childRunaway.deltaBytes >= 128 * 1024 ** 2) {
    score += 18;
    reasons.push(
      childRunaway.name
        ? `${childRunaway.name} is growing faster than the rest of the process group.`
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
  const verdict = verdictFor(level, childRunaway.deltaBytes > 0, swapDelta15m);

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

function detectChildRunaway(series: MemorySample[], windowMs: number): { name: string | null; deltaBytes: number } {
  const latest = series.at(-1);
  if (!latest) {
    return { name: null, deltaBytes: 0 };
  }

  const threshold = latest.capturedAt - windowMs;
  const baseline = series.find((sample) => sample.capturedAt >= threshold) ?? series[0];
  if (!baseline) {
    return { name: null, deltaBytes: 0 };
  }

  const before = new Map(baseline.childSummaries.map((child) => [child.name, child.rssBytes]));
  const after = new Map(latest.childSummaries.map((child) => [child.name, child.rssBytes]));

  let dominantName: string | null = null;
  let dominantDelta = 0;

  for (const [name, afterBytes] of after) {
    const delta = afterBytes - (before.get(name) ?? 0);
    if (delta > dominantDelta) {
      dominantDelta = delta;
      dominantName = name;
    }
  }

  return { name: dominantName, deltaBytes: dominantDelta };
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

function verdictFor(level: RiskLevel, childRunaway: boolean, swapDelta15m: number): string {
  if (level === "high" && childRunaway) {
    return "Child process runaway";
  }
  if (level === "high" && swapDelta15m > 0) {
    return "High memory pressure contributor";
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
