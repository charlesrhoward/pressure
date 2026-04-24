export function pruneExpandedGroupIds(expandedGroupIds: Set<string>, validGroupIds: Iterable<string>): void {
  const validGroupIdSet = new Set(validGroupIds);

  for (const groupId of [...expandedGroupIds]) {
    if (!validGroupIdSet.has(groupId)) {
      expandedGroupIds.delete(groupId);
    }
  }
}
