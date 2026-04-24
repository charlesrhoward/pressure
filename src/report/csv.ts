import type { MemorySample, ProcessEntry, ProcessGroup } from "../types/domain.ts";

type FocusKind = "root" | "child";

export function buildMonitoringCsv(target: ProcessGroup, series: MemorySample[], focusPid = target.pid): string {
  const headers = [
    "captured_at_iso",
    "captured_at_epoch_ms",
    "target_group",
    "target_group_id",
    "target_group_pid",
    "focus_pid",
    "focus_name",
    "focus_kind",
    "focus_rss_bytes",
    "focus_private_bytes",
    "focus_cpu_percent",
    "focus_runtime_seconds",
    "group_total_rss_bytes",
    "group_total_private_bytes",
    "group_cpu_percent",
    "group_runtime_seconds",
    "system_pressure_score",
    "system_pressure_level",
    "system_compressed_bytes",
    "system_swap_used_bytes",
    "system_free_bytes",
    "system_active_bytes",
    "system_inactive_bytes",
    "system_wired_bytes",
    "child_count",
    "child_rss_bytes",
    "top_child_name",
    "top_child_pid",
    "top_child_rss_bytes",
    "children_summary",
  ];

  const rows = [
    headers.join(","),
    ...series.map((sample) => buildSampleRow(target, sample, focusPid)),
  ];

  return rows.join("\n");
}

function buildSampleRow(target: ProcessGroup, sample: MemorySample, focusPid: number): string {
  const focus = resolveFocusedProcessSample(sample, focusPid);
  const childRssBytes = sample.childSummaries.reduce((sum, child) => sum + child.rssBytes, 0);
  const topChild = sample.childSummaries.reduce<ProcessEntry | null>((largest, child) => {
    if (!largest || child.rssBytes > largest.rssBytes) {
      return child;
    }
    return largest;
  }, null);

  const childrenSummary = sample.childSummaries
    .map((child) => `${child.name}#${child.pid}:${child.rssBytes}`)
    .join(" | ");

  const values = [
    new Date(sample.capturedAt).toISOString(),
    sample.capturedAt,
    target.displayName,
    target.id,
    target.pid,
    focus.process.pid,
    focus.process.name,
    focus.kind,
    focus.process.rssBytes,
    nullableValue(focus.process.privateBytes),
    focus.process.cpuPercent,
    focus.process.runtimeSeconds,
    sample.residentBytes,
    nullableValue(sample.privateBytes),
    sample.cpuPercent,
    sample.runtimeSeconds,
    sample.system.pressureScore,
    sample.system.pressureLevel,
    nullableValue(sample.system.compressedBytes),
    nullableValue(sample.system.swapUsedBytes),
    nullableValue(sample.system.freeBytes),
    nullableValue(sample.system.activeBytes),
    nullableValue(sample.system.inactiveBytes),
    nullableValue(sample.system.wiredBytes),
    sample.childSummaries.length,
    childRssBytes,
    topChild?.name ?? "",
    topChild?.pid ?? "",
    topChild?.rssBytes ?? "",
    childrenSummary,
  ];

  return values.map(csvEscape).join(",");
}

function resolveFocusedProcessSample(sample: MemorySample, focusPid: number): { process: ProcessEntry; kind: FocusKind } {
  if (sample.rootSummary.pid === focusPid) {
    return {
      process: sample.rootSummary,
      kind: "root",
    };
  }

  const child = sample.childSummaries.find((entry) => entry.pid === focusPid);
  if (child) {
    return {
      process: child,
      kind: "child",
    };
  }

  return {
    process: sample.rootSummary,
    kind: "root",
  };
}

function nullableValue(value: number | null | undefined): number | "" {
  return value ?? "";
}

function csvEscape(value: string | number): string {
  const stringValue = String(value);
  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replaceAll("\"", "\"\"")}"`;
}
