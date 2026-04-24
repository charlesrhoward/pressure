import { describe, expect, test } from "bun:test";
import { analyzeRisk } from "../src/analyzer/risk.ts";
import { createMockCollector } from "../src/collector/mock.ts";
import { resolveTargetProcess } from "../src/collector/processes.ts";
import { diffVmmapSnapshots, parseVmmapRegions } from "../src/collector/vmmap.ts";
import { buildMarkdownReport } from "../src/report/markdown.ts";
import { TimeSeriesStore } from "../src/store/timeseries.ts";
import type {
  MemorySample,
  ProcessEntry,
  ProcessGroup,
  SystemMemoryStats,
  VmmapSnapshot,
} from "../src/types/domain.ts";

const MB = 1024 ** 2;

describe("memory debugging accuracy", () => {
  test("resolves vmmap snapshots to the selected child pid inside a process group", async () => {
    const collector = createMockCollector();
    const groups = await collector.listProcessGroups();
    const cursor = groups.find((group) => group.displayName === "Cursor.app");
    expect(cursor).toBeDefined();

    const child = cursor!.children[1]!;
    const snapshot = await collector.captureVmmap({ groupId: cursor!.id, pid: child.pid });

    expect(resolveTargetProcess(cursor!, child.pid)?.pid).toBe(child.pid);
    expect(snapshot.pid).toBe(child.pid);
    expect(snapshot.targetName).toContain(child.name);
  });

  test("keeps vmmap diffs scoped to the same pid", () => {
    const store = new TimeSeriesStore();
    store.addVmmapSnapshot("app", snapshotForPid(100, 10, 6));
    store.addVmmapSnapshot("app", snapshotForPid(200, 40, 24));
    store.addVmmapSnapshot("app", snapshotForPid(100, 20, 12));

    expect(store.getLatestVmmapDiff("app")[0]?.deltaBytes).toBe(6 * MB);
    expect(store.getLatestVmmapDiff("app", 200)).toHaveLength(0);
    expect(store.getLatestVmmapDiff("app", 100)[0]?.deltaBytes).toBe(6 * MB);
  });

  test("uses dirty or resident vmmap bytes instead of virtual bytes for diffs", () => {
    const before = snapshotForPid(100, 500, 80);
    const after = snapshotForPid(100, 900, 140);
    const [row] = diffVmmapSnapshots(before, after);

    expect(row?.metric).toBe("dirty");
    expect(row?.deltaBytes).toBe(60 * MB);
  });

  test("preserves missing dirty and swap fields while parsing vmmap output", () => {
    const regions = parseVmmapRegions("VM_ALLOCATE                  1G  20M\n");

    expect(regions[0]?.virtualBytes).toBe(1024 * MB);
    expect(regions[0]?.residentBytes).toBe(20 * MB);
    expect(regions[0]?.dirtyBytes).toBeNull();
    expect(regions[0]?.swapBytes).toBeNull();
  });

  test("does not score unavailable private memory or global pressure as target-local leak evidence", () => {
    const series = [
      sampleAt(0, {
        residentMb: 600,
        privateMb: null,
        compressedMb: 100,
        swapMb: 0,
      }),
      sampleAt(15_000, {
        residentMb: 600,
        privateMb: null,
        compressedMb: 400,
        swapMb: 300,
      }),
    ];

    const assessment = analyzeRisk(series);

    expect(assessment.level).toBe("normal");
    expect(assessment.score).toBe(0);
    expect(assessment.reasons.some((reason) => reason.includes("Private memory"))).toBe(false);
    expect(assessment.reasons.some((reason) => reason.includes("target-local leak evidence"))).toBe(true);
  });

  test("detects child runaway by stable pid even when sibling names match", () => {
    const series = [
      sampleAt(0, {
        residentMb: 1000,
        childSummaries: [processEntry(10, "Renderer", 100), processEntry(11, "Renderer", 600)],
      }),
      sampleAt(15_000, {
        residentMb: 1000,
        childSummaries: [processEntry(10, "Renderer", 350), processEntry(11, "Renderer", 600)],
      }),
    ];

    const assessment = analyzeRisk(series);

    expect(assessment.metrics.childRunaway).toBe(true);
    expect(assessment.metrics.dominantChildName).toBe("Renderer");
    expect(assessment.reasons.join("\n")).toContain("(10)");
  });

  test("does not treat pid churn as a matched child runaway", () => {
    const series = [
      sampleAt(0, {
        residentMb: 1000,
        childSummaries: [processEntry(10, "Renderer", 100)],
      }),
      sampleAt(15_000, {
        residentMb: 1000,
        childSummaries: [processEntry(11, "Renderer", 350)],
      }),
    ];

    expect(analyzeRisk(series).metrics.childRunaway).toBe(false);
  });

  test("labels short reports with the actual sampled window instead of delta15m", () => {
    const target = processGroup();
    const series = [
      sampleAt(0, { residentMb: 500, privateMb: null }),
      sampleAt(15_000, { residentMb: 650, privateMb: null }),
    ];
    const assessment = analyzeRisk(series);
    const report = buildMarkdownReport({
      target,
      series,
      assessment,
      sampleMs: 1000,
      collectorMode: "mock",
      generatedAt: 15_000,
    });

    expect(report).toContain("delta15s");
    expect(report).not.toContain("delta15m");
    expect(report).toContain("Private Memory: unavailable");
  });
});

function processEntry(pid: number, name: string, rssMb: number, privateMb: number | null = null): ProcessEntry {
  return {
    pid,
    name,
    rssBytes: rssMb * MB,
    privateBytes: privateMb === null ? null : privateMb * MB,
    cpuPercent: 0,
    runtimeSeconds: 60,
    command: name,
  };
}

function processGroup(): ProcessGroup {
  const root = processEntry(100, "Example", 500);
  return {
    id: "example",
    displayName: "Example",
    pid: root.pid,
    ppid: 1,
    command: root.command,
    path: null,
    rootProcess: root,
    cpuPercent: 0,
    runtimeSeconds: 60,
    rssBytes: root.rssBytes,
    privateBytes: root.privateBytes,
    totalRssBytes: root.rssBytes,
    totalPrivateBytes: root.privateBytes,
    childCount: 0,
    children: [],
    riskHint: "normal",
  };
}

function systemStats(capturedAt: number, compressedMb = 0, swapMb = 0): SystemMemoryStats {
  return {
    capturedAt,
    totalBytes: 16 * 1024 ** 3,
    freeBytes: 8 * 1024 ** 3,
    activeBytes: null,
    inactiveBytes: null,
    wiredBytes: null,
    compressedBytes: compressedMb * MB,
    compressedStoreBytes: null,
    swapUsedBytes: swapMb * MB,
    swapTotalBytes: 4 * 1024 ** 3,
    pressureScore: 0,
    pressureLevel: "normal",
  };
}

function sampleAt(
  capturedAt: number,
  input: {
    residentMb: number;
    privateMb?: number | null;
    compressedMb?: number;
    swapMb?: number;
    childSummaries?: ProcessEntry[];
  },
): MemorySample {
  const root = processEntry(100, "Example", input.residentMb, input.privateMb ?? null);
  const system = systemStats(capturedAt, input.compressedMb ?? 0, input.swapMb ?? 0);
  return {
    capturedAt,
    groupId: "example",
    targetName: "Example",
    pid: root.pid,
    rootSummary: root,
    residentBytes: input.residentMb * MB,
    privateBytes: input.privateMb === undefined ? null : input.privateMb === null ? null : input.privateMb * MB,
    cpuPercent: 0,
    runtimeSeconds: 60,
    compressedBytes: system.compressedBytes,
    swapUsedBytes: system.swapUsedBytes,
    system,
    childSummaries: input.childSummaries ?? [],
  };
}

function snapshotForPid(pid: number, virtualMb: number, dirtyMb: number): VmmapSnapshot {
  return {
    pid,
    targetName: `pid-${pid}`,
    capturedAt: pid,
    command: null,
    raw: "",
    regions: [
      {
        name: "MALLOC_SMALL",
        virtualBytes: virtualMb * MB,
        residentBytes: Math.round(virtualMb * 0.5) * MB,
        dirtyBytes: dirtyMb * MB,
        swapBytes: 0,
      },
    ],
  };
}
