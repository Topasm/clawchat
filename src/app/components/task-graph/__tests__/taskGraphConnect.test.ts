import { describe, expect, it } from 'vitest';
import type { TodoResponse } from '../../../types/api';
import { resolveGraphConnection } from '../taskGraphConnect';

function todo(id: string, parent_id: string | null = null): TodoResponse {
  return { id, title: id, status: 'pending', parent_id } as TodoResponse;
}
const todos = [todo('root'), todo('a', 'root'), todo('a1', 'a'), todo('b', 'root')];
const relationships = [
  { id: 'r1', type: 'depends_on', source_task_id: 'b', target_task_id: 'a' } as const,
];

describe('resolveGraphConnection', () => {
  it('reads an execution edge as prerequisite → dependent', () => {
    expect(resolveGraphConnection('execution', 'a1', 'b', todos, relationships)).toEqual({
      kind: 'dependency',
      dependentTaskId: 'b',
      prerequisiteTaskId: 'a1',
    });
  });

  it('refuses a dependency that already exists and a card connected to itself', () => {
    expect(resolveGraphConnection('execution', 'a', 'b', todos, relationships)).toEqual({
      kind: 'invalid',
      reason: 'duplicate',
    });
    expect(resolveGraphConnection('execution', 'a', 'a', todos, relationships)).toEqual({
      kind: 'invalid',
      reason: 'self',
    });
  });

  it('reads a structure edge as parent → child and refuses cycles and no-ops', () => {
    expect(resolveGraphConnection('structure', 'b', 'a1', todos, [])).toEqual({
      kind: 'reparent',
      childTaskId: 'a1',
      parentTaskId: 'b',
    });
    expect(resolveGraphConnection('structure', 'a', 'a1', todos, [])).toEqual({
      kind: 'invalid',
      reason: 'same-parent',
    });
    expect(resolveGraphConnection('structure', 'a1', 'a', todos, [])).toEqual({
      kind: 'invalid',
      reason: 'cycle',
    });
  });
});
