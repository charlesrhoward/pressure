export interface TreeNavigationRow {
  kind: "group" | "process";
  groupId: string;
  pid?: number;
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

export function findStableTreeRowIndex(rows: TreeNavigationRow[], previousRow: TreeNavigationRow | null): number {
  if (!previousRow) {
    return -1;
  }

  return rows.findIndex((row) => {
    if (row.kind !== previousRow.kind || row.groupId !== previousRow.groupId) {
      return false;
    }

    return row.kind === "group" || row.pid === previousRow.pid;
  });
}
