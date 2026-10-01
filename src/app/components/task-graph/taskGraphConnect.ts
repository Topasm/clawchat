import type { TodoResponse } from '../../types/api';
import { collectTaskSubtreeIds } from './taskGraphAdapter';
import type { GraphRelationshipLike } from './taskGraphLayout';
import type { TaskGraphMode } from './taskGraphTypes';

/**
 * What a drag from one card's right edge to another card means.
 *
 * Edges on the canvas run left to right: parent → child in Structure mode,
 * prerequisite → dependent in Execution mode. A connection the user draws is
 * read the same way, so the target card is the one that changes.
 */
export type GraphConnection =
  | { kind: 'dependency'; dependentTaskId: string; prerequisiteTaskId: string }
  | { kind: 'reparent'; childTaskId: string; parentTaskId: string }
  | { kind: 'invalid'; reason: 'self' | 'duplicate' | 'same-parent' | 'cycle' };

export function resolveGraphConnection(
  mode: TaskGraphMode,
  sourceId: string,
  targetId: string,
  todos: readonly TodoResponse[],
  relationships: readonly GraphRelationshipLike[],
): GraphConnection {
  if (sourceId === targetId) return { kind: 'invalid', reason: 'self' };
  if (mode === 'execution') {
    const exists = relationships.some(
      (relationship) =>
        relationship.type === 'depends_on' &&
        relationship.source_task_id === targetId &&
        relationship.target_task_id === sourceId,
    );
    if (exists) return { kind: 'invalid', reason: 'duplicate' };
    return { kind: 'dependency', dependentTaskId: targetId, prerequisiteTaskId: sourceId };
  }
  const child = todos.find((todo) => todo.id === targetId);
  if (child?.parent_id === sourceId) return { kind: 'invalid', reason: 'same-parent' };
  if (collectTaskSubtreeIds(targetId, todos).has(sourceId)) {
    return { kind: 'invalid', reason: 'cycle' };
  }
  return { kind: 'reparent', childTaskId: targetId, parentTaskId: sourceId };
}
