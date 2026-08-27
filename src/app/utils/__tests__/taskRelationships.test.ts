import { describe, expect, it } from 'vitest';
import type { TaskRelationshipResponse } from '../../types/api';
import { getDependsOnCountBySource } from '../taskRelationships';

function relationship(
  id: string,
  sourceTaskId: string,
  targetTaskId: string,
  type: TaskRelationshipResponse['type'] = 'depends_on',
): TaskRelationshipResponse {
  return {
    id,
    source_task_id: sourceTaskId,
    target_task_id: targetTaskId,
    type,
    created_by: 'user',
    created_at: '2026-08-27T00:00:00Z',
    updated_at: '2026-08-27T00:00:00Z',
  };
}

describe('getDependsOnCountBySource', () => {
  it('indexes only depends_on relationships by source task', () => {
    const relationships = [
      relationship('rel-1', 'task-a', 'task-b'),
      relationship('rel-2', 'task-a', 'task-c'),
      relationship('rel-3', 'task-b', 'task-c'),
      relationship('rel-4', 'task-a', 'task-d', 'related'),
    ];

    const counts = getDependsOnCountBySource(relationships);

    expect(counts.get('task-a')).toBe(2);
    expect(counts.get('task-b')).toBe(1);
    expect(counts.has('task-c')).toBe(false);
  });

  it('reuses the index for the same query array identity', () => {
    const relationships = [relationship('rel-1', 'task-a', 'task-b')];

    const first = getDependsOnCountBySource(relationships);
    const second = getDependsOnCountBySource(relationships);
    const copied = getDependsOnCountBySource([...relationships]);

    expect(second).toBe(first);
    expect(copied).not.toBe(first);
    expect(copied.get('task-a')).toBe(1);
  });

  it('builds a fresh index when React Query supplies an updated array', () => {
    const initial = [relationship('rel-1', 'task-a', 'task-b')];
    const initialCounts = getDependsOnCountBySource(initial);
    const updated = [...initial, relationship('rel-2', 'task-a', 'task-c')];

    const updatedCounts = getDependsOnCountBySource(updated);

    expect(initialCounts.get('task-a')).toBe(1);
    expect(updatedCounts.get('task-a')).toBe(2);
    expect(updatedCounts).not.toBe(initialCounts);
  });
});
