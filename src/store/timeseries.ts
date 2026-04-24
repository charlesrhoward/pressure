import type { MemorySample, VmmapSnapshot } from "../types/domain.ts";
import { diffVmmapSnapshots } from "../collector/vmmap.ts";

export class TimeSeriesStore {
  private readonly samples = new Map<string, MemorySample[]>();
  private readonly vmmapSnapshots = new Map<string, VmmapSnapshot[]>();
  private readonly retentionMs: number;

  constructor(retentionMs = 60 * 60_000) {
    this.retentionMs = retentionMs;
  }

  addSample(sample: MemorySample): void {
    const bucket = this.samples.get(sample.groupId) ?? [];
    bucket.push(sample);
    const cutoff = sample.capturedAt - this.retentionMs;
    while (bucket.length > 0 && bucket[0]!.capturedAt < cutoff) {
      bucket.shift();
    }
    this.samples.set(sample.groupId, bucket);
  }

  getSeries(groupId: string): MemorySample[] {
    return [...(this.samples.get(groupId) ?? [])];
  }

  getLatest(groupId: string): MemorySample | null {
    const bucket = this.samples.get(groupId);
    return bucket?.at(-1) ?? null;
  }

  addVmmapSnapshot(groupId: string, snapshot: VmmapSnapshot): void {
    const bucket = this.vmmapSnapshots.get(groupId) ?? [];
    bucket.push(snapshot);
    while (bucket.length > 10) {
      bucket.shift();
    }
    this.vmmapSnapshots.set(groupId, bucket);
  }

  getVmmapSnapshots(groupId: string): VmmapSnapshot[] {
    return [...(this.vmmapSnapshots.get(groupId) ?? [])];
  }

  getLatestVmmapSnapshot(groupId: string): VmmapSnapshot | null {
    return this.vmmapSnapshots.get(groupId)?.at(-1) ?? null;
  }

  getLatestVmmapDiff(groupId: string) {
    const snapshots = this.vmmapSnapshots.get(groupId) ?? [];
    const before = snapshots.at(-2);
    const after = snapshots.at(-1);
    if (!before || !after) {
      return [];
    }

    return diffVmmapSnapshots(before, after);
  }
}
