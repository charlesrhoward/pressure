export interface TreeNavigationRow {
  kind: "group" | "process";
  groupId: string;
}

export function pruneExpandedGroupIds(expandedGroupIds: Set<string>, validGroupIds: Iterable<string>): void {
  const validGroupIdSet = new Set(validGroupIds);

  for (const groupId of [...expandedGroupIds]) {
    if (!validGroupIdSet.has(groupId)) {
      expandedGroupIds.delete(groupId);
    }
  }
}

export function collapseTreeRowForBackNavigation(
  row: TreeNavigationRow,
  expandedGroupIds: Set<string>,
  currentIndex: number,
  parentIndex: number,
): number {
  expandedGroupIds.delete(row.groupId);
  return row.kind === "process" ? parentIndex : currentIndex;
}
