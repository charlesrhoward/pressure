export type RiskLevel = "normal" | "watch" | "suspicious" | "high";
export type ReportFormat = "markdown" | "json" | "text";

export interface ProcessEntry {
  pid: number;
  name: string;
  rssBytes: number;
  privateBytes: number | null;
  cpuPercent: number;
  runtimeSeconds: number;
  command: string;
}

export interface ProcessGroup {
  id: string;
  displayName: string;
  pid: number;
  ppid: number;
  command: string;
  path: string | null;
  rootProcess: ProcessEntry;
  cpuPercent: number;
  runtimeSeconds: number;
  rssBytes: number;
  privateBytes: number | null;
  totalRssBytes: number;
  totalPrivateBytes: number | null;
  childCount: number;
  children: ProcessEntry[];
  riskHint: RiskLevel;
}

export interface SystemMemoryStats {
  capturedAt: number;
  totalBytes: number | null;
  freeBytes: number | null;
  activeBytes: number | null;
  inactiveBytes: number | null;
  wiredBytes: number | null;
  compressedBytes: number | null;
  compressedStoreBytes: number | null;
  swapUsedBytes: number | null;
  swapTotalBytes: number | null;
  pressureScore: number;
  pressureLevel: RiskLevel;
}

export interface MemorySample {
  capturedAt: number;
  groupId: string;
  targetName: string;
  pid: number;
  rootSummary: ProcessEntry;
  residentBytes: number;
  privateBytes: number | null;
  cpuPercent: number;
  runtimeSeconds: number;
  compressedBytes: number | null;
  swapUsedBytes: number | null;
  system: SystemMemoryStats;
  childSummaries: ProcessEntry[];
}

export interface VmmapRegionSummary {
  name: string;
  virtualBytes: number;
  residentBytes: number | null;
  dirtyBytes: number | null;
  swapBytes: number | null;
}

export interface VmmapSnapshot {
  pid: number;
  targetName: string;
  capturedAt: number;
  command: string | null;
  raw: string;
  regions: VmmapRegionSummary[];
}

export interface VmmapDiffRow {
  name: string;
  beforeBytes: number;
  afterBytes: number;
  deltaBytes: number;
  trend: "rising" | "falling" | "stable";
}

export interface IdleTestResult {
  active: boolean;
  startedAt: number;
  baselinePrivateBytes: number | null;
  latestPrivateBytes: number | null;
  recoveredBytes: number | null;
  recoveryRatio: number | null;
  outcome: "pending" | "recovered" | "not_recovered";
}

export interface RiskAssessmentMetrics {
  residentDelta5m: number;
  residentDelta15m: number;
  residentDelta1h: number;
  privateDelta15m: number;
  compressedDelta15m: number;
  swapDelta15m: number;
  childRunaway: boolean;
  dominantChildName: string | null;
  recoveryRatio: number | null;
  steadyGrowth: boolean;
  repeatedRegions: string[];
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  verdict: string;
  confidence: number;
  reasons: string[];
  suggestedActions: string[];
  metrics: RiskAssessmentMetrics;
}

export interface CollectorSelector {
  groupId?: string;
  pid?: number;
  appName?: string;
  search?: string;
}

export interface CollectorSampleResult {
  groups: ProcessGroup[];
  target: ProcessGroup | null;
  sample: MemorySample | null;
}

export interface Collector {
  mode: "live" | "mock";
  description: string;
  listProcessGroups(filter?: string): Promise<ProcessGroup[]>;
  collectSample(selector: CollectorSelector): Promise<CollectorSampleResult>;
  captureVmmap(selector: CollectorSelector): Promise<VmmapSnapshot>;
}

export interface CliOptions {
  command: "tui" | "snapshot" | "diff" | "report" | "monitor";
  app?: string;
  pid?: number;
  sampleMs: number;
  recordDurationMs?: number;
  exportPath?: string;
  outputPath?: string;
  beforePath?: string;
  afterPath?: string;
  format: ReportFormat;
  mock: boolean;
  help: boolean;
}

export interface ReportContext {
  target: ProcessGroup;
  series: MemorySample[];
  assessment: RiskAssessment;
  sampleMs: number;
  collectorMode: "live" | "mock";
  vmmapDiff?: VmmapDiffRow[];
  latestSnapshot?: VmmapSnapshot;
  generatedAt: number;
}
