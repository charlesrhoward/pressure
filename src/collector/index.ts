import type { Collector, CollectorSelector } from "../types/domain.ts";
import { createMockCollector } from "./mock.ts";
import { collectProcessMemorySample } from "./memory.ts";
import { listProcessGroups, resolveTargetGroup, resolveTargetProcess } from "./processes.ts";
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

      const targetProcess = resolveTargetProcess(target, selector.pid);
      if (!targetProcess) {
        throw new Error("Selected process is no longer present in the target group.");
      }

      const targetName =
        targetProcess.pid === target.rootProcess.pid ? target.displayName : `${target.displayName} / ${targetProcess.name}`;
      return captureVmmapSnapshot(targetProcess.pid, targetName, targetProcess.command);
    },
  };
}
