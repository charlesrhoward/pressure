import type { Collector, CollectorSelector } from "../types/domain.ts";
import { createMockCollector } from "./mock.ts";
import { collectProcessMemorySample } from "./memory.ts";
import { listProcessGroups, resolveTargetGroup } from "./processes.ts";
import { captureVmmapSnapshot } from "./vmmap.ts";

export function createCollector(forceMock = false): Collector {
  if (forceMock || process.platform !== "darwin") {
    return createMockCollector();
  }

  return {
    mode: "live",
    description: "macOS process and vm_stat collector",
    listProcessGroups,
    collectSample: collectProcessMemorySample,
    async captureVmmap(selector: CollectorSelector) {
      const groups = await listProcessGroups(selector.search);
      const target = resolveTargetGroup(groups, selector);
      if (!target) {
        throw new Error("No process selected for vmmap snapshot.");
      }

      return captureVmmapSnapshot(target.pid, target.displayName, target.command);
    },
  };
}
