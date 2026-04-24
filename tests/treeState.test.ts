import { describe, expect, test } from "bun:test";
import { pruneExpandedGroupIds } from "../src/ui/treeState.ts";

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
});
