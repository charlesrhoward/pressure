import { describe, expect, test } from "bun:test";
import { collapseTreeRowForBackNavigation, pruneExpandedGroupIds } from "../src/ui/treeState.ts";

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
});
