import type { TaskRelationshipResponse } from '../types/api';

const dependsOnCountIndexCache = new WeakMap<
  readonly TaskRelationshipResponse[],
  ReadonlyMap<string, number>
>();

/**
 * Build a source-task dependency count index once for each query result array.
 * React Query preserves the array identity between updates, so every TaskCard
 * can share this index and perform an O(1) lookup.
 */
export function getDependsOnCountBySource(
  relationships: readonly TaskRelationshipResponse[],
): ReadonlyMap<string, number> {
  const cached = dependsOnCountIndexCache.get(relationships);
  if (cached) return cached;

  const counts = new Map<string, number>();
  relationships.forEach((relationship) => {
    if (relationship.type !== 'depends_on') return;
    counts.set(relationship.source_task_id, (counts.get(relationship.source_task_id) ?? 0) + 1);
  });
  dependsOnCountIndexCache.set(relationships, counts);
  return counts;
}
