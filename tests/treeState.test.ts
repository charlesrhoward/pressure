import { describe, expect, test } from "bun:test";
import { collapseTreeRowForBackNavigation, findStableTreeRowIndex, pruneExpandedGroupIds } from "../src/ui/treeState.ts";

describe("process tree expansion state", () => {
  test("does not auto-expand a valid selected group during refresh", () => {
    const expandedGroupIds = new Set<string>();

    pruneExpandedGroupIds(expandedGroupIds, ["cursor"]);

    expect([...expandedGroupIds]).toEqual([]);
  });

  test("preserves valid expanded groups and prunes stale groups", () => {
    const expandedGroupIds = new Set(["cursor", "stale"]);

    pruneExpandedGroupIds(expandedGroupIds, ["cursor", "slack"]);

    expect([...expandedGroupIds]).toEqual(["cursor"]);
  });

  test("back navigation on a group row closes its accordion in place", () => {
    const expandedGroupIds = new Set(["cursor"]);

    const nextIndex = collapseTreeRowForBackNavigation({ kind: "group", groupId: "cursor" }, expandedGroupIds, 3, 3);

    expect(nextIndex).toBe(3);
    expect([...expandedGroupIds]).toEqual([]);
  });

  test("back navigation on a process row closes its parent accordion and focuses the parent", () => {
    const expandedGroupIds = new Set(["cursor"]);

    const nextIndex = collapseTreeRowForBackNavigation({ kind: "process", groupId: "cursor" }, expandedGroupIds, 4, 3);

    expect(nextIndex).toBe(3);
    expect([...expandedGroupIds]).toEqual([]);
  });

  test("refresh keeps focus on a different visible group while a selected target is sampled", () => {
    const rows = [
      { kind: "group" as const, groupId: "codex", pid: 100 },
      { kind: "group" as const, groupId: "iterm", pid: 200 },
    ];

    expect(findStableTreeRowIndex(rows, { kind: "group", groupId: "iterm", pid: 200 })).toBe(1);
  });

  test("refresh keeps focus on a visible child process by group and pid", () => {
    const rows = [
      { kind: "group" as const, groupId: "codex", pid: 100 },
      { kind: "group" as const, groupId: "iterm", pid: 200 },
      { kind: "process" as const, groupId: "iterm", pid: 201 },
    ];

    expect(findStableTreeRowIndex(rows, { kind: "process", groupId: "iterm", pid: 201 })).toBe(2);
  });
});
