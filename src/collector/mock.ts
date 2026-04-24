import type {
  Collector,
  CollectorSampleResult,
  CollectorSelector,
  MemorySample,
  ProcessEntry,
  ProcessGroup,
  RiskLevel,
  SystemMemoryStats,
  VmmapRegionSummary,
  VmmapSnapshot,
} from "../types/domain.ts";
import { slugify } from "../utils/format.ts";
import { resolveTargetGroup, resolveTargetProcess } from "./processes.ts";

interface MockChildDefinition {
  pid: number;
  name: string;
  baseMb: number;
  growthMbPerTick: number;
  wobbleMb: number;
  cpuPercent: number;
}

interface MockGroupDefinition {
  pid: number;
  ppid: number;
  displayName: string;
  command: string;
  baseMb: number;
  growthMbPerTick: number;
  wobbleMb: number;
  cpuPercent: number;
  riskHint: RiskLevel;
  children: MockChildDefinition[];
}

const DEFINITIONS: MockGroupDefinition[] = [
  {
    pid: 8421,
    ppid: 1,
    displayName: "Cursor.app",
    command: "/Applications/Cursor.app/Contents/MacOS/Cursor",
    baseMb: 940,
    growthMbPerTick: 7.6,
    wobbleMb: 22,
    cpuPercent: 18.4,
    riskHint: "high",
    children: [
      { pid: 8422, name: "Cursor Helper", baseMb: 620, growthMbPerTick: 4.2, wobbleMb: 14, cpuPercent: 7.1 },
      { pid: 8423, name: "Cursor Renderer", baseMb: 540, growthMbPerTick: 5.3, wobbleMb: 18, cpuPercent: 5.8 },
      { pid: 8424, name: "Cursor GPU", baseMb: 228, growthMbPerTick: 1.1, wobbleMb: 10, cpuPercent: 2.4 },
      { pid: 8425, name: "Cursor Extension Host", baseMb: 334, growthMbPerTick: 2.6, wobbleMb: 11, cpuPercent: 3.3 },
    ],
  },
  {
    pid: 9110,
    ppid: 1,
    displayName: "Google Chrome",
    command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    baseMb: 820,
    growthMbPerTick: 1.3,
    wobbleMb: 18,
    cpuPercent: 7.2,
    riskHint: "watch",
    children: [
      { pid: 9111, name: "Chrome Helper", baseMb: 420, growthMbPerTick: 0.8, wobbleMb: 12, cpuPercent: 2.5 },
      { pid: 9112, name: "Chrome GPU", baseMb: 190, growthMbPerTick: 0.4, wobbleMb: 8, cpuPercent: 1.8 },
    ],
  },
  {
    pid: 9220,
    ppid: 1,
    displayName: "Slack",
    command: "/Applications/Slack.app/Contents/MacOS/Slack",
    baseMb: 710,
    growthMbPerTick: 0.5,
    wobbleMb: 12,
    cpuPercent: 4.4,
    riskHint: "watch",
    children: [{ pid: 9221, name: "Slack Helper", baseMb: 280, growthMbPerTick: 0.4, wobbleMb: 8, cpuPercent: 1.1 }],
  },
  {
    pid: 9330,
    ppid: 1,
    displayName: "Figma",
    command: "/Applications/Figma.app/Contents/MacOS/Figma",
    baseMb: 624,
    growthMbPerTick: 0.6,
    wobbleMb: 10,
    cpuPercent: 3.8,
    riskHint: "normal",
    children: [{ pid: 9331, name: "Figma Helper", baseMb: 220, growthMbPerTick: 0.2, wobbleMb: 5, cpuPercent: 0.9 }],
  },
  {
    pid: 9440,
    ppid: 1,
    displayName: "Docker Desktop",
    command: "/Applications/Docker.app/Contents/MacOS/Docker Desktop",
    baseMb: 1412,
    growthMbPerTick: 0.7,
    wobbleMb: 24,
    cpuPercent: 11.5,
    riskHint: "suspicious",
    children: [
      { pid: 9441, name: "Docker Backend", baseMb: 880, growthMbPerTick: 0.5, wobbleMb: 12, cpuPercent: 6.4 },
      { pid: 9442, name: "Docker VPNKit", baseMb: 312, growthMbPerTick: 0.2, wobbleMb: 8, cpuPercent: 1.2 },
    ],
  },
];

export function createMockCollector(): Collector {
  return new MockCollector();
}

class MockCollector implements Collector {
  mode = "mock" as const;
  description = "Synthetic macOS memory dataset for OpenTUI development";
  private tick = 0;
  private cachedGroups = this.buildGroups();

  async listProcessGroups(filter?: string): Promise<ProcessGroup[]> {
    return this.filterGroups(this.cachedGroups, filter);
  }

  async collectSample(selector: CollectorSelector): Promise<CollectorSampleResult> {
    this.tick += 1;
    this.cachedGroups = this.buildGroups();
    const groups = this.filterGroups(this.cachedGroups, selector.search);
    const target = resolveTargetGroup(groups, selector);

    if (!target) {
      return {
        groups,
        target: null,
        sample: null,
      };
    }

    return {
      groups,
      target,
      sample: this.buildSample(target),
    };
  }

  async captureVmmap(selector: CollectorSelector): Promise<VmmapSnapshot> {
    const target = resolveTargetGroup(this.cachedGroups, selector);
    if (!target) {
      throw new Error("Mock snapshot requested without a selected process.");
    }

    const targetProcess = resolveTargetProcess(target, selector.pid);
    if (!targetProcess) {
      throw new Error("Mock snapshot requested for a process outside the selected group.");
    }

    const regionDefinitions: Array<[string, number]> = [
      ["MALLOC_SMALL", 1240 + this.tick * 8],
      ["WebKit JS Heap", 812 + this.tick * 5],
      ["ImageIO", 244 + Math.sin(this.tick / 3) * 18 + this.tick * 1.2],
      ["CoreAnimation", 508 + Math.sin(this.tick / 5) * 6],
      ["SQLite Cache", 122 + Math.sin(this.tick / 6) * 4],
    ];

    const regions: VmmapRegionSummary[] = regionDefinitions
      .map(([name, megabytes]) => ({
        name,
        virtualBytes: Math.round(Number(megabytes) * 1024 * 1024),
        residentBytes: Math.round(Number(megabytes) * 0.84 * 1024 * 1024),
        dirtyBytes: Math.round(Number(megabytes) * 0.42 * 1024 * 1024),
        swapBytes: name === "WebKit JS Heap" ? Math.round(this.tick * 1.6 * 1024 * 1024) : 0,
      }))
      .sort((left, right) => right.virtualBytes - left.virtualBytes);

    const raw = [
      `Pressure mock vmmap summary for ${targetProcess.name}`,
      "REGION TYPE                    [ VSIZE  RSDNT  DIRTY   SWAP]",
      ...regions.map((region) => {
        return `${region.name.padEnd(28)} [ ${toMegabytes(region.virtualBytes)} ${toMegabytes(region.residentBytes)} ${toMegabytes(region.dirtyBytes)} ${toMegabytes(region.swapBytes)} ]`;
      }),
    ].join("\n");

    return {
      pid: targetProcess.pid,
      targetName:
        targetProcess.pid === target.rootProcess.pid ? target.displayName : `${target.displayName} / ${targetProcess.name}`,
      capturedAt: Date.now(),
      command: targetProcess.command,
      raw,
      regions,
    };
  }

  private buildGroups(): ProcessGroup[] {
    return DEFINITIONS.map((definition, index) => {
      const rootMb = measure(definition.baseMb, definition.growthMbPerTick, definition.wobbleMb, this.tick, index);
      const rootBytes = Math.round(rootMb * 1024 * 1024);
      const children = definition.children.map((child, childIndex) => this.buildChild(child, index + childIndex + 1));
      const totalRssBytes = rootBytes + children.reduce((sum, child) => sum + child.rssBytes, 0);
      const totalPrivateBytes = Math.round(totalRssBytes * 0.76);

      return {
        id: slugify(definition.displayName),
        displayName: definition.displayName,
        pid: definition.pid,
        ppid: definition.ppid,
        command: definition.command,
        path: definition.command,
        rootProcess: {
          pid: definition.pid,
          name: definition.displayName,
          rssBytes: rootBytes,
          privateBytes: Math.round(rootBytes * 0.76),
          cpuPercent: roundOne(definition.cpuPercent + Math.sin((this.tick + index) / 4) * 1.4),
          runtimeSeconds: 3600 + this.tick * 5 + index * 113,
          command: definition.command,
        },
        cpuPercent: roundOne(
          definition.cpuPercent +
            Math.sin((this.tick + index) / 4) * 1.4 +
            children.reduce((sum, child) => sum + child.cpuPercent, 0),
        ),
        runtimeSeconds: 3600 + this.tick * 5 + index * 113,
        rssBytes: rootBytes,
        privateBytes: Math.round(rootBytes * 0.76),
        totalRssBytes,
        totalPrivateBytes,
        childCount: children.length,
        children,
        riskHint: definition.riskHint,
      };
    }).sort((left, right) => right.totalRssBytes - left.totalRssBytes);
  }

  private buildChild(definition: MockChildDefinition, phase: number): ProcessEntry {
    const rssBytes = Math.round(
      measure(definition.baseMb, definition.growthMbPerTick, definition.wobbleMb, this.tick, phase) * 1024 * 1024,
    );

    return {
      pid: definition.pid,
      name: definition.name,
      rssBytes,
      privateBytes: Math.round(rssBytes * 0.74),
      cpuPercent: roundOne(definition.cpuPercent + Math.sin((this.tick + phase) / 3) * 0.8),
      runtimeSeconds: 3600 + this.tick * 5 + phase * 37,
      command: definition.name,
    };
  }

  private buildSample(target: ProcessGroup): MemorySample {
    const system = this.buildSystemStats();
    return {
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
  }

  private buildSystemStats(): SystemMemoryStats {
    const totalBytes = 64 * 1024 ** 3;
    const compressedBytes = Math.round((720 + this.tick * 6 + Math.sin(this.tick / 4) * 80) * 1024 * 1024);
    const swapUsedBytes = Math.round(Math.max(0, 96 + this.tick * 5 - 40 * Math.cos(this.tick / 5)) * 1024 * 1024);
    const freeBytes = Math.round((5.2 * 1024 ** 3) - this.tick * 11 * 1024 * 1024);

    return {
      capturedAt: Date.now(),
      totalBytes,
      freeBytes,
      activeBytes: Math.round(30.5 * 1024 ** 3),
      inactiveBytes: Math.round(18.4 * 1024 ** 3),
      wiredBytes: Math.round(6.8 * 1024 ** 3),
      compressedBytes,
      compressedStoreBytes: Math.round(compressedBytes * 1.75),
      swapUsedBytes,
      swapTotalBytes: 12 * 1024 ** 3,
      pressureScore: clampNumber(28 + this.tick * 2, 0, 100),
      pressureLevel: derivePressureLevel(28 + this.tick * 2),
    };
  }

  private filterGroups(groups: ProcessGroup[], filter?: string): ProcessGroup[] {
    if (!filter) {
      return groups.map(cloneGroup);
    }

    const normalized = filter.toLowerCase();
    return groups
      .filter((group) => {
        return (
          group.displayName.toLowerCase().includes(normalized) ||
          group.command.toLowerCase().includes(normalized) ||
          group.children.some((child) => child.name.toLowerCase().includes(normalized))
        );
      })
      .map(cloneGroup);
  }
}

function cloneGroup(group: ProcessGroup): ProcessGroup {
  return {
    ...group,
    rootProcess: { ...group.rootProcess },
    children: group.children.map((child) => ({ ...child })),
  };
}

function measure(baseMb: number, growthMbPerTick: number, wobbleMb: number, tick: number, phase: number): number {
  return Math.max(32, baseMb + growthMbPerTick * tick + Math.sin((tick + phase) / 3) * wobbleMb);
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function toMegabytes(bytes: number | null): string {
  const value = bytes ?? 0;
  return `${Math.round(value / 1024 / 1024)}M`;
}

function derivePressureLevel(score: number): RiskLevel {
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
