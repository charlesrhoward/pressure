import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeRisk } from "../analyzer/risk.ts";
import { resolveTargetGroup } from "../collector/processes.ts";
import { buildReport } from "../report/markdown.ts";
import { TimeSeriesStore } from "../store/timeseries.ts";
import type { Collector, CollectorSelector, IdleTestResult, ProcessGroup, ReportContext, VmmapDiffRow } from "../types/domain.ts";
import { collapseTreeRowForBackNavigation, pruneExpandedGroupIds } from "./treeState.ts";
import {
  clamp,
  formatBytes,
  formatDeltaBytes,
  formatDurationFromSeconds,
  formatPercent,
  formatTimestamp,
  formatTrend,
  sparkline,
  toFileSafeTimestamp,
  truncate,
} from "../utils/format.ts";

interface RunPressureAppOptions {
  collector: Collector;
  sampleMs: number;
  recordDurationMs?: number;
  exportPath?: string;
  initialSelection: CollectorSelector;
}

interface ProcessTreeRow {
  kind: "group" | "process";
  groupId: string;
  pid: number;
  label: string;
  rssBytes: number;
  cpuPercent: number;
  runtimeSeconds: number;
  processCount: number;
  depth: number;
  expanded?: boolean;
  isMainProcess?: boolean;
}

const COLORS = {
  bg: "#090c10",
  panel: "#10161d",
  border: "#27313d",
  text: "#d8e2ec",
  muted: "#718090",
  dim: "#4f5c6b",
  cyan: "#53d3ff",
  cyanSoft: "#164657",
  amber: "#f7b955",
  red: "#ff6b6b",
  green: "#65d28a",
} as const;

const PANEL_TITLES = {
  processes: "Process Explorer",
  timeline: "Memory Timeline",
  diagnosis: "Diagnosis",
  breakdown: "Process Drilldown",
  diff: "Snapshot Diff",
  log: "Event Log",
} as const;

const IDLE_TEST_DURATION_MS = 20_000;
const PROCESS_PANEL_WIDTH = 60;
const PROCESS_TEXT_WIDTH = 56;
const PROCESS_ROW_COUNT = 24;
const DIAGNOSIS_PANEL_WIDTH = 26;
const BREAKDOWN_PANEL_HEIGHT = 10;
const BREAKDOWN_ROW_COUNT = 7;
const EVENT_PANEL_HEIGHT = 6;
const EVENT_ROW_COUNT = 4;

export async function runPressureApp(options: RunPressureAppOptions): Promise<void> {
  const opentui = await loadOpenTui();
  const { createCliRenderer, BoxRenderable, TextRenderable } = opentui;

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
    targetFps: 30,
    openConsoleOnError: false,
    consoleMode: "disabled",
  });

  const store = new TimeSeriesStore();
  const events: string[] = [];
  let searchText = options.initialSelection.search ?? "";
  let searchMode = false;
  let helpVisible = false;
  let diffMode = false;
  let recording = Boolean(options.recordDurationMs);
  let recordEndsAt = options.recordDurationMs ? Date.now() + options.recordDurationMs : null;
  let autoExported = false;
  let highlightedIndex = 0;
  let processScrollOffset = 0;
  let selectedGroupId = options.initialSelection.groupId ?? "";
  let currentTarget: ProcessGroup | null = null;
  let groups: ProcessGroup[] = [];
  const expandedGroupIds = new Set<string>();
  let idleTest: IdleTestResult | null = null;
  let refreshInFlight = false;
  let isShuttingDown = false;

  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: COLORS.bg,
    padding: 1,
    gap: 1,
  });

  const headerPanel = new BoxRenderable(renderer, {
    height: 3,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 1,
  });
  const headerText = new TextRenderable(renderer, {
    content: "",
    fg: COLORS.text,
  });
  headerPanel.add(headerText);

  const bodyRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    gap: 1,
    flexGrow: 1,
  });

  const processPanel = new BoxRenderable(renderer, {
    width: PROCESS_PANEL_WIDTH,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 1,
    gap: 0,
    title: PANEL_TITLES.processes,
  });
  const searchRow = new TextRenderable(renderer, {
    content: "",
    fg: COLORS.muted,
  });
  processPanel.add(searchRow);
  const processRows = Array.from({ length: PROCESS_ROW_COUNT }, () => {
    const row = new TextRenderable(renderer, {
      content: "",
      fg: COLORS.dim,
    });
    processPanel.add(row);
    return row;
  });

  const timelinePanel = new BoxRenderable(renderer, {
    flexGrow: 1,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 1,
    gap: 0,
    title: PANEL_TITLES.timeline,
  });
  const timelineRows = Array.from({ length: 8 }, () => {
    const row = new TextRenderable(renderer, {
      content: "",
      fg: COLORS.text,
    });
    timelinePanel.add(row);
    return row;
  });

  const diagnosisPanel = new BoxRenderable(renderer, {
    width: DIAGNOSIS_PANEL_WIDTH,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 1,
    gap: 0,
    title: PANEL_TITLES.diagnosis,
  });
  const diagnosisRows = Array.from({ length: 10 }, () => {
    const row = new TextRenderable(renderer, {
      content: "",
      fg: COLORS.muted,
    });
    diagnosisPanel.add(row);
    return row;
  });

  bodyRow.add(processPanel);
  bodyRow.add(timelinePanel);
  bodyRow.add(diagnosisPanel);

  const breakdownPanel = new BoxRenderable(renderer, {
    height: BREAKDOWN_PANEL_HEIGHT,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 1,
    gap: 0,
    title: PANEL_TITLES.breakdown,
  });
  const breakdownRows = Array.from({ length: BREAKDOWN_ROW_COUNT }, () => {
    const row = new TextRenderable(renderer, {
      content: "",
      fg: COLORS.muted,
    });
    breakdownPanel.add(row);
    return row;
  });

  const eventPanel = new BoxRenderable(renderer, {
    height: EVENT_PANEL_HEIGHT,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 1,
    gap: 0,
    title: PANEL_TITLES.log,
  });
  const eventRows = Array.from({ length: EVENT_ROW_COUNT }, () => {
    const row = new TextRenderable(renderer, {
      content: "",
      fg: COLORS.muted,
    });
    eventPanel.add(row);
    return row;
  });

  const footerPanel = new BoxRenderable(renderer, {
    height: 3,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 1,
  });
  const footerText = new TextRenderable(renderer, {
    content: "",
    fg: COLORS.muted,
  });
  footerPanel.add(footerText);

  root.add(headerPanel);
  root.add(bodyRow);
  root.add(breakdownPanel);
  root.add(eventPanel);
  root.add(footerPanel);
  renderer.root.add(root);

  addEvent(`collector ready (${options.collector.mode})`);

  const initialResult = await initialRefresh();
  if (initialResult.target && initialResult.sample) {
    currentTarget = initialResult.target;
    selectedGroupId = initialResult.target.id;
    expandedGroupIds.add(initialResult.target.id);
    highlightedIndex = indexForPid(options.initialSelection.pid ?? initialResult.target.pid, indexForGroupId(initialResult.target.id));
    store.addSample(initialResult.sample);
    addEvent(`selected ${initialResult.target.displayName}`);
  }

  render();

  const interval = setInterval(() => {
    void refreshTick();
  }, options.sampleMs);

  const keyHandler = (key: any) => {
    void handleKey(key);
  };
  renderer.keyInput.on("keypress", keyHandler);

  if (typeof renderer.on === "function") {
    renderer.on("destroy", () => {
      if (!isShuttingDown) {
        clearInterval(interval);
        isShuttingDown = true;
      }
    });
  }

  async function initialRefresh() {
    const selector: CollectorSelector = {
      ...options.initialSelection,
      search: searchText || undefined,
    };

      if (selector.pid !== undefined || selector.appName || selector.groupId) {
        const result = await options.collector.collectSample(selector);
        groups = result.groups;
        syncTreeState();
        if (!result.target) {
          currentTarget = resolveTargetGroup(groups, selector);
        }
      return result;
    }

    groups = await options.collector.listProcessGroups(searchText || undefined);
    syncTreeState();
    clampHighlight();
    return { groups, target: null, sample: null };
  }

  async function refreshTick(forceSample = false): Promise<void> {
    if (refreshInFlight || isShuttingDown) {
      return;
    }
    refreshInFlight = true;

    try {
      const previousFocusedRow = getHighlightedTreeRow();
      const selector: CollectorSelector = {
        groupId: selectedGroupId || undefined,
        pid: currentTarget?.pid ?? options.initialSelection.pid,
        appName: selectedGroupId ? undefined : options.initialSelection.appName,
        search: searchText || undefined,
      };

      if (selectedGroupId || selector.pid !== undefined || selector.appName || forceSample) {
        const result = await options.collector.collectSample(selector);
        groups = result.groups;
        syncTreeState();
        if (result.target) {
          currentTarget = result.target;
          selectedGroupId = result.target.id;
          selector.pid = result.target.pid;
          selector.groupId = result.target.id;
          const preferredPid =
            previousFocusedRow && previousFocusedRow.groupId === result.target.id ? previousFocusedRow.pid : result.target.pid;
          highlightedIndex = indexForPid(preferredPid, indexForGroupId(result.target.id, highlightedIndex));

          if (result.sample) {
            store.addSample(result.sample);
            updateIdleTest(result.sample);
          }
        } else if (selectedGroupId) {
          addEvent("selected target disappeared from the current view");
        }
      } else {
        groups = await options.collector.listProcessGroups(searchText || undefined);
        syncTreeState();
      }

      clampHighlight();
      handleRecordingWindow();
      render();
    } catch (error) {
      addEvent(error instanceof Error ? error.message : String(error));
      render();
    } finally {
      refreshInFlight = false;
    }
  }

  function render(): void {
    const focusedRow = getHighlightedTreeRow();
    const activeGroup = currentTarget ?? (focusedRow ? findGroupById(focusedRow.groupId) : null);
    const diffRows = activeGroup ? store.getLatestVmmapDiff(activeGroup.id) : [];
    const latestSnapshot = activeGroup ? store.getLatestVmmapSnapshot(activeGroup.id) : null;
    const assessment =
      activeGroup && store.getSeries(activeGroup.id).length > 0
        ? analyzeRisk(store.getSeries(activeGroup.id), {
            idleTest,
            vmmapDiff: diffRows,
          })
        : null;

    updateHeader(activeGroup, assessment, focusedRow);
    updateProcessPanel();
    updateTimeline(activeGroup, assessment);
    updateDiagnosis(activeGroup, assessment);
    updateBreakdown(activeGroup, focusedRow, diffRows, latestSnapshot);
    updateEventPanel();
    updateFooter(activeGroup, focusedRow);
    renderer.requestRender();
  }

  function updateHeader(
    activeGroup: ProcessGroup | null,
    assessment: ReturnType<typeof analyzeRisk> | null,
    focusedRow: ProcessTreeRow | null,
  ): void {
    const runtime = activeGroup ? formatDurationFromSeconds(activeGroup.runtimeSeconds) : "--:--:--";
    const targetLabel = activeGroup ? activeGroup.displayName : "No target selected";
    const pidLabel = activeGroup ? String(activeGroup.pid) : "—";
    const riskLabel = assessment ? assessment.level.toUpperCase() : "IDLE";
    const status = recording ? "REC ●" : "LIVE ●";
    const drillLabel =
      focusedRow && focusedRow.kind === "process" ? `  Drill: ${truncate(focusedRow.label, 28)} (${focusedRow.pid})` : "";
    headerText.content = `Pressure  ${status}  Target: ${targetLabel}  PID: ${pidLabel}  Runtime: ${runtime}  Sampling: ${options.sampleMs}ms  Risk: ${riskLabel}  Mode: ${options.collector.mode}${drillLabel}`;
    headerText.fg = assessment ? colorForRisk(assessment.level) : COLORS.text;
  }

  function updateProcessPanel(): void {
    const treeRows = buildProcessTreeRows();
    const visibleCount = Math.min(treeRows.length, processRows.length);
    const rangeStart = treeRows.length === 0 ? 0 : processScrollOffset + 1;
    const rangeEnd = treeRows.length === 0 ? 0 : Math.min(treeRows.length, processScrollOffset + visibleCount);
    const filterLabel = searchMode ? `${searchText || ""}_` : searchText || "all running";
    searchRow.content = `Search: ${filterLabel}  rows ${rangeStart}-${rangeEnd}/${treeRows.length}  apps ${groups.length}`;
    searchRow.fg = searchMode ? COLORS.cyan : COLORS.muted;

    const lines = buildProcessLines();
    for (let index = 0; index < processRows.length; index += 1) {
      const row = processRows[index];
      const line = lines[index];
      row.content = line?.content ?? "";
      row.fg = line?.fg ?? COLORS.dim;
      row.bg = line?.bg ?? undefined;
    }
  }

  function buildProcessLines(): Array<{ content: string; fg: string; bg?: string }> {
    const lines: Array<{ content: string; fg: string; bg?: string }> = [];
    const treeRows = buildProcessTreeRows();
    const start = clamp(processScrollOffset, 0, Math.max(0, treeRows.length - 1));
    const end = Math.min(treeRows.length, start + processRows.length);

    for (let index = start; index < end; index += 1) {
      const row = treeRows[index];
      if (!row) {
        continue;
      }

      const isHighlighted = index === highlightedIndex;
      const isSelected = row.groupId === selectedGroupId;
      const marker = isHighlighted ? "›" : isSelected ? "●" : " ";
      const nameWidth = row.kind === "group" ? 29 : 26;
      const namePrefix =
        row.kind === "group"
          ? `${row.expanded ? "▾" : "▸"} ${truncate(row.label, nameWidth)}`
          : `${"  ".repeat(row.depth)}${row.isMainProcess ? "◆" : "↳"} ${truncate(row.label, nameWidth)}`;
      const stats = `${formatBytes(row.rssBytes).padStart(9)} ${formatPercent(row.cpuPercent, 0).padStart(5)}`;
      const processCountLabel = row.kind === "group" ? ` ${String(row.processCount).padStart(2)}p` : "";

      lines.push({
        content: `${marker} ${namePrefix.padEnd(37)} ${stats}${processCountLabel}`.slice(0, PROCESS_TEXT_WIDTH),
        fg:
          row.kind === "group"
            ? isSelected
              ? COLORS.text
              : isHighlighted
                ? COLORS.cyan
                : COLORS.muted
            : isHighlighted
              ? COLORS.cyan
              : row.isMainProcess
                ? COLORS.text
                : COLORS.dim,
        bg: isHighlighted ? COLORS.cyanSoft : undefined,
      });
    }

    return lines;
  }

  function updateTimeline(
    activeGroup: ProcessGroup | null,
    assessment: ReturnType<typeof analyzeRisk> | null,
  ): void {
    if (!activeGroup) {
      timelineRows[0].content = "Select a running app to begin sampling.";
      timelineRows[0].fg = COLORS.text;
      timelineRows[1].content = "Pressure groups helpers under a parent app so Electron-style trees stay readable.";
      timelineRows[1].fg = COLORS.muted;
      for (let index = 2; index < timelineRows.length; index += 1) {
        timelineRows[index].content = "";
      }
      return;
    }

    const series = store.getSeries(activeGroup.id);
    const latest = series.at(-1);
    const residentValues = series.map((sample) => sample.residentBytes);
    const privateValues = series.map((sample) => sample.privateBytes ?? sample.residentBytes);
    const compressedValues = series.map((sample) => sample.compressedBytes ?? 0);
    const swapValues = series.map((sample) => sample.swapUsedBytes ?? 0);

    timelineRows[0].content = chartLine(
      "Private Memory",
      latest?.privateBytes ?? activeGroup.totalPrivateBytes,
      assessment?.metrics.privateDelta15m ?? 0,
      privateValues,
    );
    timelineRows[1].content = chartLine(
      "Resident Memory",
      latest?.residentBytes ?? activeGroup.totalRssBytes,
      assessment?.metrics.residentDelta15m ?? 0,
      residentValues,
    );
    timelineRows[2].content = chartLine(
      "Compressed",
      latest?.compressedBytes ?? latest?.system.compressedBytes ?? 0,
      assessment?.metrics.compressedDelta15m ?? 0,
      compressedValues,
    );
    timelineRows[3].content = chartLine(
      "Swap Impact",
      latest?.swapUsedBytes ?? latest?.system.swapUsedBytes ?? 0,
      assessment?.metrics.swapDelta15m ?? 0,
      swapValues,
    );

    timelineRows[0].fg = COLORS.cyan;
    timelineRows[1].fg = COLORS.text;
    timelineRows[2].fg = COLORS.amber;
    timelineRows[3].fg = assessment && assessment.metrics.swapDelta15m > 0 ? COLORS.red : COLORS.muted;
    timelineRows[4].content = `5m delta: ${formatDeltaBytes(assessment?.metrics.residentDelta5m ?? 0)}   1h delta: ${formatDeltaBytes(assessment?.metrics.residentDelta1h ?? 0)}`;
    timelineRows[4].fg = COLORS.muted;
    timelineRows[5].content = `CPU: ${formatPercent(activeGroup.cpuPercent)}   Children: ${activeGroup.childCount}   Runtime: ${formatDurationFromSeconds(activeGroup.runtimeSeconds)}`;
    timelineRows[5].fg = COLORS.muted;
    timelineRows[6].content = idleLine();
    timelineRows[6].fg = idleTest?.active ? COLORS.amber : COLORS.dim;
    timelineRows[7].content = assessment?.metrics.steadyGrowth
      ? "Trend shape: steady rise, not just noisy bursts."
      : "Trend shape: mixed or bursty.";
    timelineRows[7].fg = assessment?.metrics.steadyGrowth ? COLORS.cyan : COLORS.dim;
  }

  function idleLine(): string {
    if (!idleTest) {
      return "Idle test: press i to check whether memory recovers after a quiet period.";
    }
    if (idleTest.active) {
      return `Idle test running: baseline ${formatBytes(idleTest.baselinePrivateBytes)} current ${formatBytes(idleTest.latestPrivateBytes)}`;
    }
    return `Idle test: ${idleTest.outcome.replaceAll("_", " ")} (${formatPercent((idleTest.recoveryRatio ?? 0) * 100)})`;
  }

  function updateDiagnosis(
    activeGroup: ProcessGroup | null,
    assessment: ReturnType<typeof analyzeRisk> | null,
  ): void {
    if (!activeGroup || !assessment) {
      diagnosisRows[0].content = "Verdict: waiting for a target";
      diagnosisRows[0].fg = COLORS.text;
      diagnosisRows[1].content = "Select a process group with Enter.";
      diagnosisRows[1].fg = COLORS.muted;
      diagnosisRows[2].content = "The right panel becomes the answer area once sampling starts.";
      diagnosisRows[2].fg = COLORS.muted;
      for (let index = 3; index < diagnosisRows.length; index += 1) {
        diagnosisRows[index].content = "";
      }
      return;
    }

    diagnosisRows[0].content = `Verdict: ${assessment.verdict}`;
    diagnosisRows[0].fg = colorForRisk(assessment.level);
    diagnosisRows[1].content = `Confidence: ${assessment.confidence}%`;
    diagnosisRows[1].fg = COLORS.text;
    diagnosisRows[2].content = `Risk: ${assessment.score}/100 (${assessment.level})`;
    diagnosisRows[2].fg = colorForRisk(assessment.level);

    const lines = [...assessment.reasons.slice(0, 4), ...assessment.suggestedActions.slice(0, 2).map((line) => `Next: ${line}`)];
    for (let index = 0; index < 7; index += 1) {
      const line = lines[index];
      diagnosisRows[index + 3].content = line ? truncate(line, 42) : "";
      diagnosisRows[index + 3].fg = index < assessment.reasons.length ? COLORS.muted : COLORS.cyan;
    }
  }

  function updateBreakdown(
    activeGroup: ProcessGroup | null,
    focusedRow: ProcessTreeRow | null,
    diffRows: VmmapDiffRow[],
    latestSnapshot: { regions: Array<{ name: string; virtualBytes: number }> } | null,
  ): void {
    const title =
      diffMode && diffRows.length > 0
        ? PANEL_TITLES.diff
        : focusedRow && focusedRow.kind === "process"
          ? `Process Drilldown - ${truncate(focusedRow.label, 28)}`
          : PANEL_TITLES.breakdown;
    breakdownPanel.title = title;

    const rows =
      diffMode && diffRows.length > 0
        ? buildDiffRows(diffRows)
        : buildBreakdownRows(activeGroup, latestSnapshot, focusedRow);
    for (let index = 0; index < breakdownRows.length; index += 1) {
      const row = breakdownRows[index];
      const value = rows[index];
      row.content = value?.content ?? "";
      row.fg = value?.fg ?? COLORS.muted;
    }
  }

  function buildDiffRows(rows: VmmapDiffRow[]): Array<{ content: string; fg: string }> {
    const output: Array<{ content: string; fg: string }> = [
      { content: "Region / Source               Before      After       Delta       Trend", fg: COLORS.text },
    ];
    for (const row of rows.slice(0, 6)) {
      output.push({
        content: `${truncate(row.name, 24).padEnd(26)} ${formatBytes(row.beforeBytes).padStart(9)} ${formatBytes(row.afterBytes).padStart(9)} ${formatDeltaBytes(row.deltaBytes).padStart(10)} ${row.trend}`,
        fg: row.deltaBytes > 0 ? COLORS.amber : row.deltaBytes < 0 ? COLORS.green : COLORS.muted,
      });
    }
    return output;
  }

  function buildBreakdownRows(
    activeGroup: ProcessGroup | null,
    latestSnapshot: { regions: Array<{ name: string; virtualBytes: number }> } | null,
    focusedRow: ProcessTreeRow | null,
  ): Array<{ content: string; fg: string }> {
    if (!activeGroup) {
      return [{ content: "Run a snapshot on a selected process to populate deeper memory breakdowns.", fg: COLORS.muted }];
    }

    const processRowsForGroup = buildGroupProcessRows(activeGroup);
    const rows: Array<{ content: string; fg: string }> = [
      { content: "Process / Role                     RSS       CPU   Runtime", fg: COLORS.text },
      ...processRowsForGroup.slice(0, BREAKDOWN_ROW_COUNT - 3).map((row) => {
        const isFocused = focusedRow?.pid === row.pid;
        const processLabel = `${row.isMainProcess ? "main" : "child"} ${truncate(row.label, 24)}`;
        return {
          content: `${processLabel.padEnd(32)} ${formatBytes(row.rssBytes).padStart(9)} ${formatPercent(row.cpuPercent, 0).padStart(5)} ${formatDurationFromSeconds(row.runtimeSeconds)}`,
          fg: isFocused ? COLORS.cyan : row.isMainProcess ? COLORS.text : COLORS.muted,
        };
      }),
      {
        content: `Group total                         ${formatBytes(activeGroup.totalRssBytes).padStart(9)} ${formatPercent(activeGroup.cpuPercent, 0).padStart(5)} ${formatDurationFromSeconds(activeGroup.runtimeSeconds)}`,
        fg: COLORS.amber,
      },
      {
        content: `Private estimate                    ${formatBytes(activeGroup.totalPrivateBytes ?? 0).padStart(9)}  n/a   heuristic`,
        fg: COLORS.cyan,
      },
    ];

    const topRegion = latestSnapshot?.regions[0];
    if (topRegion && rows.length < BREAKDOWN_ROW_COUNT) {
      rows.push({
        content: `Latest snapshot top region         ${formatBytes(topRegion.virtualBytes).padStart(9)}  n/a   ${truncate(topRegion.name, 18)}`,
        fg: COLORS.dim,
      });
    }

    return rows;
  }

  function updateEventPanel(): void {
    const lines = helpVisible
      ? [
          "q quit   / search   up/down move   enter select",
          "left/right or space drill   s snapshot   d diff",
          "e export report   ? close help",
          "The live collector uses ps, vm_stat, sysctl, and vmmap when available.",
          "Pressure is opinionated about suspicious growth, not proof of a confirmed leak.",
          `Search mode: ${searchMode ? "active" : "idle"}`,
        ]
      : events.slice(-eventRows.length);

    for (let index = 0; index < eventRows.length; index += 1) {
      eventRows[index].content = lines[index] ?? "";
      eventRows[index].fg = helpVisible ? COLORS.muted : COLORS.muted;
    }
  }

  function updateFooter(activeGroup: ProcessGroup | null, focusedRow: ProcessTreeRow | null): void {
    const targetText = activeGroup ? `${activeGroup.displayName} (${activeGroup.pid})` : "none";
    const recordText = recording ? "recording" : "live";
    const drillText = focusedRow && focusedRow.kind === "process" ? `   Focus ${focusedRow.label} (${focusedRow.pid})` : "";
    footerText.content = `Target ${targetText}${drillText}   State ${recordText}   q quit   / search   left/right drill   enter select   s snapshot   e export   ? help`;
  }

  async function handleKey(key: any): Promise<void> {
    if (searchMode) {
      handleSearchKey(key);
      render();
      return;
    }

    switch (key.name) {
      case "q":
        shutdown();
        return;
      case "up":
        highlightedIndex = clamp(highlightedIndex - 1, 0, Math.max(0, buildProcessTreeRows().length - 1));
        render();
        return;
      case "down":
        highlightedIndex = clamp(highlightedIndex + 1, 0, Math.max(0, buildProcessTreeRows().length - 1));
        render();
        return;
      case "left":
        collapseOrAscend();
        render();
        return;
      case "right":
        expandHighlightedGroup();
        render();
        return;
      case "space":
        toggleHighlightedExpansion();
        render();
        return;
      case "return":
      case "enter":
        await selectHighlightedRow();
        return;
      case "/":
        searchMode = true;
        render();
        return;
      case "s":
        await captureSnapshot();
        return;
      case "r":
        toggleRecording();
        render();
        return;
      case "i":
        startIdleTest();
        render();
        return;
      case "d":
        diffMode = !diffMode;
        render();
        return;
      case "e":
        await exportReport();
        return;
      case "?":
        helpVisible = !helpVisible;
        render();
        return;
      default:
        return;
    }
  }

  function handleSearchKey(key: any): void {
    if (key.name === "escape") {
      searchMode = false;
      return;
    }

    if (key.name === "backspace") {
      searchText = searchText.slice(0, -1);
      void refreshSearch();
      return;
    }

    if (key.name === "return" || key.name === "enter") {
      searchMode = false;
      void refreshSearch();
      return;
    }

    const sequence = typeof key.sequence === "string" ? key.sequence : "";
    if (sequence.length === 1 && sequence >= " " && !key.ctrl && !key.meta) {
      searchText += sequence;
      void refreshSearch();
    }
  }

  async function refreshSearch(): Promise<void> {
    groups = await options.collector.listProcessGroups(searchText || undefined);
    syncTreeState();
    clampHighlight();
    render();
  }

  async function selectHighlightedRow(): Promise<void> {
    const row = getHighlightedTreeRow();
    if (!row) {
      return;
    }

    const group = findGroupById(row.groupId);
    if (!group) {
      return;
    }

    selectedGroupId = group.id;
    currentTarget = group;
    options.initialSelection.pid = row.pid;
    addEvent(row.kind === "group" ? `selected ${group.displayName}` : `drilled into ${group.displayName} / ${row.label}`);
    idleTest = null;
    await refreshTick(true);
  }

  async function captureSnapshot(): Promise<void> {
    const focusedRow = getHighlightedTreeRow();
    const group = currentTarget ?? (focusedRow ? findGroupById(focusedRow.groupId) : null);
    if (!group) {
      addEvent("select a process before capturing a snapshot");
      render();
      return;
    }

    try {
      const snapshot = await options.collector.captureVmmap({ groupId: group.id, pid: group.pid });
      store.addVmmapSnapshot(group.id, snapshot);
      addEvent(`snapshot captured for ${group.displayName}`);
    } catch (error) {
      addEvent(error instanceof Error ? `snapshot failed: ${error.message}` : "snapshot failed");
    }

    render();
  }

  function toggleRecording(): void {
    recording = !recording;
    recordEndsAt = recording && options.recordDurationMs ? Date.now() + options.recordDurationMs : null;
    autoExported = false;
    addEvent(recording ? "recording started" : "recording stopped");
  }

  function startIdleTest(): void {
    const group = currentTarget ?? groups[highlightedIndex];
    if (!group) {
      addEvent("select a process before starting an idle test");
      return;
    }

    const latest = store.getLatest(group.id);
    idleTest = {
      active: true,
      startedAt: Date.now(),
      baselinePrivateBytes: latest?.privateBytes ?? group.totalPrivateBytes,
      latestPrivateBytes: latest?.privateBytes ?? group.totalPrivateBytes,
      recoveredBytes: 0,
      recoveryRatio: 0,
      outcome: "pending",
    };
    addEvent("idle test started");
  }

  function updateIdleTest(sample: { privateBytes: number | null }): void {
    if (!idleTest || !idleTest.active) {
      return;
    }

    idleTest.latestPrivateBytes = sample.privateBytes;
    const baseline = idleTest.baselinePrivateBytes ?? 0;
    const latest = sample.privateBytes ?? baseline;
    idleTest.recoveredBytes = Math.max(0, baseline - latest);
    idleTest.recoveryRatio = baseline > 0 ? idleTest.recoveredBytes / baseline : null;

    if (Date.now() - idleTest.startedAt >= IDLE_TEST_DURATION_MS) {
      idleTest.active = false;
      idleTest.outcome = (idleTest.recoveryRatio ?? 0) >= 0.12 ? "recovered" : "not_recovered";
      addEvent(
        idleTest.outcome === "recovered" ? "idle test recovered memory" : "idle test did not show meaningful recovery",
      );
    }
  }

  function handleRecordingWindow(): void {
    if (!recording || !recordEndsAt || Date.now() < recordEndsAt) {
      return;
    }

    recording = false;
    addEvent("recording window complete");
    if (options.exportPath && !autoExported) {
      autoExported = true;
      void exportReport(options.exportPath, true);
    }
  }

  async function exportReport(explicitPath?: string, silent = false): Promise<void> {
    const group = currentTarget ?? groups[highlightedIndex];
    if (!group) {
      addEvent("select a process before exporting a report");
      render();
      return;
    }

    if (store.getSeries(group.id).length === 0) {
      await refreshTick(true);
    }

    const series = store.getSeries(group.id);
    const assessment = analyzeRisk(series, {
      idleTest,
      vmmapDiff: store.getLatestVmmapDiff(group.id),
    });
    const context: ReportContext = {
      target: currentTarget ?? group,
      series,
      assessment,
      sampleMs: options.sampleMs,
      collectorMode: options.collector.mode,
      vmmapDiff: store.getLatestVmmapDiff(group.id),
      latestSnapshot: store.getLatestVmmapSnapshot(group.id) ?? undefined,
      generatedAt: Date.now(),
    };

    const destination =
      explicitPath ??
      options.exportPath ??
      path.join(process.cwd(), `pressure-report-${group.id}-${toFileSafeTimestamp()}.md`);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, buildReport(context, "markdown"), "utf8");

    if (!silent) {
      addEvent(`report ready ${path.basename(destination)}`);
      render();
    }
  }

  function addEvent(message: string): void {
    events.push(`${formatTimestamp(Date.now())} ${message}`);
    while (events.length > 32) {
      events.shift();
    }
  }

  function syncTreeState(): void {
    pruneExpandedGroupIds(
      expandedGroupIds,
      groups.map((group) => group.id),
    );
  }

  function buildProcessTreeRows(): ProcessTreeRow[] {
    const rows: ProcessTreeRow[] = [];

    for (const group of groups) {
      const processCount = group.children.length + 1;
      const expanded = expandedGroupIds.has(group.id);
      rows.push({
        kind: "group",
        groupId: group.id,
        pid: group.pid,
        label: group.displayName,
        rssBytes: group.totalRssBytes,
        cpuPercent: group.cpuPercent,
        runtimeSeconds: group.runtimeSeconds,
        processCount,
        depth: 0,
        expanded,
      });

      if (expanded) {
        rows.push(...buildGroupProcessRows(group));
      }
    }

    return rows;
  }

  function buildGroupProcessRows(group: ProcessGroup): ProcessTreeRow[] {
    return [
      {
        kind: "process",
        groupId: group.id,
        pid: group.pid,
        label: `${group.displayName} main`,
        rssBytes: group.rootProcess.rssBytes,
        cpuPercent: group.rootProcess.cpuPercent,
        runtimeSeconds: group.rootProcess.runtimeSeconds,
        processCount: 1,
        depth: 1,
        isMainProcess: true,
      },
      ...group.children.map((child) => ({
        kind: "process" as const,
        groupId: group.id,
        pid: child.pid,
        label: child.name,
        rssBytes: child.rssBytes,
        cpuPercent: child.cpuPercent,
        runtimeSeconds: child.runtimeSeconds,
        processCount: 1,
        depth: 1,
        isMainProcess: false,
      })),
    ];
  }

  function findGroupById(groupId: string): ProcessGroup | null {
    return groups.find((group) => group.id === groupId) ?? null;
  }

  function getHighlightedTreeRow(): ProcessTreeRow | null {
    return buildProcessTreeRows()[highlightedIndex] ?? null;
  }

  function toggleHighlightedExpansion(): void {
    const row = getHighlightedTreeRow();
    if (!row || row.kind !== "group") {
      return;
    }

    if (expandedGroupIds.has(row.groupId)) {
      expandedGroupIds.delete(row.groupId);
    } else {
      expandedGroupIds.add(row.groupId);
    }
    clampHighlight();
  }

  function expandHighlightedGroup(): void {
    const row = getHighlightedTreeRow();
    if (!row) {
      return;
    }

    if (row.kind === "group") {
      expandedGroupIds.add(row.groupId);
      clampHighlight();
      return;
    }

    highlightedIndex = indexForGroupId(row.groupId, highlightedIndex);
    expandedGroupIds.add(row.groupId);
    clampHighlight();
  }

  function collapseOrAscend(): void {
    const row = getHighlightedTreeRow();
    if (!row) {
      return;
    }

    const parentIndex = row.kind === "process" ? indexForGroupId(row.groupId, highlightedIndex) : highlightedIndex;
    highlightedIndex = collapseTreeRowForBackNavigation(row, expandedGroupIds, highlightedIndex, parentIndex);
    clampHighlight();
  }

  function clampHighlight(): void {
    const treeRows = buildProcessTreeRows();
    highlightedIndex = clamp(highlightedIndex, 0, Math.max(0, treeRows.length - 1));
    const maxOffset = Math.max(0, treeRows.length - processRows.length);
    if (highlightedIndex < processScrollOffset) {
      processScrollOffset = highlightedIndex;
    } else if (highlightedIndex >= processScrollOffset + processRows.length) {
      processScrollOffset = highlightedIndex - processRows.length + 1;
    }
    processScrollOffset = clamp(processScrollOffset, 0, maxOffset);
  }

  function indexForGroupId(groupId: string, fallback = 0): number {
    const nextIndex = buildProcessTreeRows().findIndex((row) => row.groupId === groupId && row.kind === "group");
    return nextIndex === -1 ? fallback : nextIndex;
  }

  function indexForPid(pid: number, fallback = 0): number {
    const nextIndex = buildProcessTreeRows().findIndex((row) => row.pid === pid);
    return nextIndex === -1 ? fallback : nextIndex;
  }

  function chartLine(label: string, current: number | null | undefined, delta: number, values: number[]): string {
    return `${label.padEnd(17)} ${formatBytes(current).padStart(9)} ${formatTrend(delta)} ${formatDeltaBytes(delta).padStart(10)} ${sparkline(values, 20)}`;
  }

  function colorForRisk(level: string): string {
    switch (level) {
      case "high":
        return COLORS.red;
      case "suspicious":
        return COLORS.amber;
      case "watch":
        return COLORS.cyan;
      default:
        return COLORS.green;
    }
  }

  function shutdown(): void {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    clearInterval(interval);
    renderer.keyInput.off("keypress", keyHandler);
    renderer.destroy();
  }
}

async function loadOpenTui(): Promise<any> {
  try {
    return await import("@opentui/core");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OpenTUI could not be loaded. Install dependencies with Bun and ensure Zig is available for @opentui/core. (${reason})`,
    );
  }
}
