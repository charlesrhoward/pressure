#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeRisk } from "./analyzer/risk.ts";
import { createCollector } from "./collector/index.ts";
import { diffVmmapSnapshots } from "./collector/vmmap.ts";
import { buildMonitoringCsv } from "./report/csv.ts";
import { buildDiffMarkdown, buildReport } from "./report/markdown.ts";
import { TimeSeriesStore } from "./store/timeseries.ts";
import type { CliOptions, CollectorSelector, MemorySample, ProcessGroup, ReportContext, VmmapSnapshot } from "./types/domain.ts";
import { buildUsage, parseCliArgs } from "./utils/args.ts";
import { toFileSafeTimestamp } from "./utils/format.ts";
import { runPressureApp } from "./ui/App.ts";

async function main(): Promise<void> {
  const argv = typeof Bun !== "undefined" ? Bun.argv.slice(2) : process.argv.slice(2);
  const options = parseCliArgs(argv);

  if (options.help) {
    console.log(buildUsage());
    return;
  }

  const collector = createCollector(options.mock);

  switch (options.command) {
    case "snapshot":
      await handleSnapshot(options, collector);
      return;
    case "diff":
      handleDiff(options);
      return;
    case "report":
      await handleReport(options, collector);
      return;
    case "monitor":
      await handleMonitor(options, collector);
      return;
    case "tui":
    default:
      await runPressureApp({
        collector,
        sampleMs: options.sampleMs,
        recordDurationMs: options.recordDurationMs,
        exportPath: options.exportPath,
        initialSelection: selectorFromCli(options),
      });
  }
}

async function handleSnapshot(options: CliOptions, collector: ReturnType<typeof createCollector>): Promise<void> {
  const selector = selectorFromCli(options);
  if (selector.pid === undefined && !selector.appName) {
    throw new Error("Snapshot mode requires `--pid` or `--app`.");
  }

  const snapshot = await collector.captureVmmap(selector);
  const output = JSON.stringify(snapshot, null, 2);
  const destination = options.outputPath ?? options.exportPath;
  if (destination) {
    writeOutputFile(destination, output);
    console.log(destination);
    return;
  }

  console.log(output);
}

function handleDiff(options: CliOptions): void {
  if (!options.beforePath || !options.afterPath) {
    throw new Error("Diff mode requires `--before` and `--after`.");
  }

  const before = JSON.parse(readFileSync(options.beforePath, "utf8")) as VmmapSnapshot;
  const after = JSON.parse(readFileSync(options.afterPath, "utf8")) as VmmapSnapshot;
  const diff = diffVmmapSnapshots(before, after);
  const output =
    options.format === "json"
      ? JSON.stringify(diff, null, 2)
      : options.format === "text"
        ? diff
            .slice(0, 20)
            .map((row) => `${row.name} ${row.metric}: ${row.deltaBytes >= 0 ? "+" : ""}${row.deltaBytes} bytes (${row.trend})`)
            .join("\n")
        : buildDiffMarkdown(diff, options.beforePath, options.afterPath);

  if (options.outputPath ?? options.exportPath) {
    writeOutputFile(options.outputPath ?? options.exportPath!, output);
    console.log(options.outputPath ?? options.exportPath);
    return;
  }

  console.log(output);
}

async function handleReport(options: CliOptions, collector: ReturnType<typeof createCollector>): Promise<void> {
  const recording = await recordTargetSeries(options, collector, {
    defaultDurationMs: 15_000,
    requireExplicitTarget: false,
  });

  let latestSnapshot: VmmapSnapshot | undefined;
  try {
    latestSnapshot = await collector.captureVmmap({ groupId: recording.target.id, pid: recording.focusPid });
    recording.store.addVmmapSnapshot(recording.target.id, latestSnapshot);
  } catch {
    latestSnapshot = undefined;
  }

  const assessment = analyzeRisk(recording.series, {
    vmmapDiff: recording.store.getLatestVmmapDiff(recording.target.id, recording.focusPid),
  });

  const context: ReportContext = {
    target: recording.target,
    series: recording.series,
    assessment,
    sampleMs: options.sampleMs,
    collectorMode: collector.mode,
    vmmapDiff: recording.store.getLatestVmmapDiff(recording.target.id, recording.focusPid),
    latestSnapshot,
    generatedAt: Date.now(),
  };

  const output = buildReport(context, options.format);
  const destination =
    options.outputPath ??
    options.exportPath ??
    path.join(process.cwd(), `pressure-report-${recording.target.id}-${toFileSafeTimestamp()}.${extensionForFormat(options.format)}`);

  writeOutputFile(destination, output);
  console.log(destination);
}

async function handleMonitor(options: CliOptions, collector: ReturnType<typeof createCollector>): Promise<void> {
  if (options.pid === undefined && !options.app) {
    throw new Error("Monitor mode requires `--pid` or `--app`.");
  }

  const recording = await recordTargetSeries(options, collector, {
    defaultDurationMs: 60_000,
    requireExplicitTarget: true,
  });

  const output = buildMonitoringCsv(recording.target, recording.series, recording.focusPid);
  const destination =
    options.outputPath ??
    options.exportPath ??
    path.join(process.cwd(), `pressure-monitor-${recording.target.id}-${toFileSafeTimestamp()}.csv`);

  writeOutputFile(destination, output);
  console.log(destination);
}

interface RecordedSeriesResult {
  target: ProcessGroup;
  series: MemorySample[];
  store: TimeSeriesStore;
  focusPid: number;
}

async function recordTargetSeries(
  options: CliOptions,
  collector: ReturnType<typeof createCollector>,
  config: {
    defaultDurationMs: number;
    requireExplicitTarget: boolean;
  },
): Promise<RecordedSeriesResult> {
  const selector = selectorFromCli(options);
  const durationMs = options.recordDurationMs ?? config.defaultDurationMs;
  const store = new TimeSeriesStore();
  const explicitTargetRequested = selector.pid !== undefined || Boolean(selector.appName);
  const focusPid = options.pid;

  let selectedGroup: ProcessGroup | null = null;
  const startedAt = Date.now();

  while (Date.now() - startedAt < durationMs || store.getSeries(selectedGroup?.id ?? "").length < 2) {
    const result = await collector.collectSample(selector);
    selectedGroup = result.target ?? selectedGroup ?? (!config.requireExplicitTarget ? result.groups[0] ?? null : null);

    if (!selectedGroup) {
      if (explicitTargetRequested) {
        throw new Error("Unable to resolve the requested target process.");
      }
      throw new Error("Unable to resolve a target process for recording.");
    }

    if (result.sample) {
      store.addSample(result.sample);
    }

    selector.groupId = selectedGroup.id;
    await sleep(options.sampleMs);
  }

  if (!selectedGroup) {
    throw new Error("Unable to resolve a target process for recording.");
  }

  return {
    target: selectedGroup,
    series: store.getSeries(selectedGroup.id),
    store,
    focusPid: focusPid ?? selectedGroup.pid,
  };
}

function selectorFromCli(options: CliOptions): CollectorSelector {
  return {
    appName: options.app,
    pid: options.pid,
  };
}

function extensionForFormat(format: CliOptions["format"]): string {
  if (format === "json") {
    return "json";
  }
  if (format === "text") {
    return "txt";
  }
  return "md";
}

function writeOutputFile(filePath: string, contents: string): void {
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Pressure error: ${message}`);
  process.exitCode = 1;
});
