import type { ReportContext, ReportFormat, VmmapDiffRow } from "../types/domain.ts";
import {
  formatBytes,
  formatDeltaBytes,
  formatDurationFromSeconds,
  formatPercent,
  formatTimestamp,
  sparkline,
  truncate,
} from "../utils/format.ts";

export function buildReport(context: ReportContext, format: ReportFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(context, null, 2);
    case "text":
      return buildTextReport(context);
    case "markdown":
    default:
      return buildMarkdownReport(context);
  }
}

export function buildMarkdownReport(context: ReportContext): string {
  const latest = context.series.at(-1);
  const privateValues = context.series.map((sample) => sample.privateBytes ?? sample.residentBytes);
  const residentValues = context.series.map((sample) => sample.residentBytes);
  const compressedValues = context.series.map((sample) => sample.compressedBytes ?? 0);
  const swapValues = context.series.map((sample) => sample.swapUsedBytes ?? 0);

  const lines = [
    `# Pressure Report - ${context.target.displayName} - ${context.assessment.verdict}`,
    "",
    `Generated: ${new Date(context.generatedAt).toISOString()}`,
    `Collector mode: ${context.collectorMode}`,
    `Sampling interval: ${context.sampleMs} ms`,
    `Samples captured: ${context.series.length}`,
    `Target PID: ${context.target.pid}`,
    `Runtime: ${formatDurationFromSeconds(latest?.runtimeSeconds ?? context.target.rootProcess.runtimeSeconds)}`,
    "",
    "## Summary",
    "",
    `- Risk: ${context.assessment.score}/100 (${context.assessment.level})`,
    `- Verdict: ${context.assessment.verdict}`,
    `- Confidence: ${context.assessment.confidence}%`,
    `- Current resident memory: ${formatBytes(latest?.residentBytes ?? context.target.totalRssBytes)}`,
    `- Current private memory estimate: ${formatBytes(latest?.privateBytes ?? context.target.totalPrivateBytes)}`,
    "",
    "## Key Signals",
    "",
    ...context.assessment.reasons.map((reason) => `- ${reason}`),
    "",
    "## Timeline",
    "",
    `- Private Memory: ${sparkline(privateValues, 32)}  current ${formatBytes(privateValues.at(-1))}  delta15m ${formatDeltaBytes(context.assessment.metrics.privateDelta15m)}`,
    `- Resident Memory: ${sparkline(residentValues, 32)}  current ${formatBytes(residentValues.at(-1))}  delta15m ${formatDeltaBytes(context.assessment.metrics.residentDelta15m)}`,
    `- Compressed Memory: ${sparkline(compressedValues, 32)}  current ${formatBytes(compressedValues.at(-1))}  delta15m ${formatDeltaBytes(context.assessment.metrics.compressedDelta15m)}`,
    `- Swap Used: ${sparkline(swapValues, 32)}  current ${formatBytes(swapValues.at(-1))}  delta15m ${formatDeltaBytes(context.assessment.metrics.swapDelta15m)}`,
    "",
    "## Child Processes",
    "",
    "| Process | PID | RSS | Private | CPU | Runtime |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| ${context.target.displayName} | ${context.target.pid} | ${formatBytes(context.target.rootProcess.rssBytes)} | ${formatBytes(context.target.rootProcess.privateBytes)} | ${formatPercent(context.target.rootProcess.cpuPercent)} | ${formatDurationFromSeconds(context.target.rootProcess.runtimeSeconds)} |`,
    ...context.target.children.map((child) => {
      return `| ${truncate(child.name, 48)} | ${child.pid} | ${formatBytes(child.rssBytes)} | ${formatBytes(child.privateBytes)} | ${formatPercent(child.cpuPercent)} | ${formatDurationFromSeconds(child.runtimeSeconds)} |`;
    }),
    "",
    "## Suggested Next Actions",
    "",
    ...context.assessment.suggestedActions.map((action) => `- ${action}`),
    "",
    "## Memory Breakdown",
    "",
    ...renderVmmapSection(context.vmmapDiff ?? [], context.latestSnapshot?.regions ?? []),
  ];

  return lines.join("\n");
}

export function buildTextReport(context: ReportContext): string {
  const latest = context.series.at(-1);
  const lines = [
    `Pressure Report - ${context.target.displayName}`,
    `Generated: ${new Date(context.generatedAt).toISOString()}`,
    `Risk: ${context.assessment.score}/100 (${context.assessment.level})`,
    `Verdict: ${context.assessment.verdict}`,
    `Confidence: ${context.assessment.confidence}%`,
    `Resident: ${formatBytes(latest?.residentBytes ?? context.target.totalRssBytes)}`,
    `Private: ${formatBytes(latest?.privateBytes ?? context.target.totalPrivateBytes)}`,
    "",
    "Signals:",
    ...context.assessment.reasons.map((reason) => `- ${reason}`),
    "",
    "Actions:",
    ...context.assessment.suggestedActions.map((action) => `- ${action}`),
  ];

  return lines.join("\n");
}

export function buildDiffMarkdown(rows: VmmapDiffRow[], beforePath: string, afterPath: string): string {
  return [
    `# Pressure Snapshot Diff`,
    "",
    `Before: ${beforePath}`,
    `After: ${afterPath}`,
    "",
    "| Region | Before | After | Delta | Trend |",
    "| --- | ---: | ---: | ---: | --- |",
    ...rows.slice(0, 20).map((row) => {
      return `| ${row.name} | ${formatBytes(row.beforeBytes)} | ${formatBytes(row.afterBytes)} | ${formatDeltaBytes(row.deltaBytes)} | ${row.trend} |`;
    }),
  ].join("\n");
}

function renderVmmapSection(diffRows: VmmapDiffRow[], regions: { name: string; virtualBytes: number }[]): string[] {
  if (diffRows.length > 0) {
    return [
      "| Region / Source | Before | After | Delta | Trend |",
      "| --- | ---: | ---: | ---: | --- |",
      ...diffRows.slice(0, 10).map((row) => {
        return `| ${row.name} | ${formatBytes(row.beforeBytes)} | ${formatBytes(row.afterBytes)} | ${formatDeltaBytes(row.deltaBytes)} | ${row.trend} |`;
      }),
    ];
  }

  if (regions.length > 0) {
    return [
      "| Region / Source | Current | Captured At |",
      "| --- | ---: | --- |",
      ...regions.slice(0, 10).map((region) => {
        return `| ${region.name} | ${formatBytes(region.virtualBytes)} | ${formatTimestamp(Date.now())} |`;
      }),
    ];
  }

  return ["No vmmap snapshot was captured in this report window."];
}
