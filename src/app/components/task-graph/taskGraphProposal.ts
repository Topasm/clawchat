import type { PlanSubtask, TodoResponse } from '../../types/api';
import type { GraphRelationshipLike } from './taskGraphLayout';

export const PROPOSAL_ROOT_ID = 'proposal:root';

export function proposalNodeId(index: number) {
  return `proposal:subtask:${index}`;
}

export function proposalIndexFromNodeId(nodeId: string): number | null {
  const prefix = 'proposal:subtask:';
  if (!nodeId.startsWith(prefix)) return null;
  const index = Number(nodeId.slice(prefix.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function buildProposalTodos(root: TodoResponse, subtasks: PlanSubtask[]): TodoResponse[] {
  const now = new Date().toISOString();
  const virtualRoot: TodoResponse = {
    ...root,
    id: PROPOSAL_ROOT_ID,
    status: 'pending',
    parent_id: null,
    created_at: root.created_at || now,
    updated_at: root.updated_at || now,
  };
  const children = subtasks.map((subtask, index): TodoResponse => ({
    id: proposalNodeId(index),
    title: subtask.title,
    description: subtask.description,
    status: 'pending',
    priority: subtask.priority ?? 'medium',
    due_date: subtask.due_date,
    tags: root.tags ?? [],
    parent_id: PROPOSAL_ROOT_ID,
    sort_order: index,
    project_label: root.title,
    created_at: now,
    updated_at: now,
  }));

  return [virtualRoot, ...children];
}

export function buildProposalRelationships(subtasks: PlanSubtask[]): GraphRelationshipLike[] {
  return subtasks.flatMap((subtask, index) =>
    [...new Set(subtask.depends_on_indices ?? [])].flatMap((dependencyIndex) => {
      if (dependencyIndex < 0 || dependencyIndex >= subtasks.length || dependencyIndex === index) {
        return [];
      }
      return [
        {
          id: `proposal:relationship:${index}:${dependencyIndex}`,
          source_task_id: proposalNodeId(index),
          target_task_id: proposalNodeId(dependencyIndex),
          type: 'depends_on',
        },
      ];
    }),
  );
}

/**
 * Selection always remains executable: including a task includes its full
 * prerequisite chain; excluding one also excludes every dependent task.
 */
export function toggleProposalSelection(
  subtasks: PlanSubtask[],
  current: ReadonlySet<number>,
  index: number,
): Set<number> {
  const next = new Set(current);
  if (index < 0 || index >= subtasks.length) return next;

  if (next.has(index)) {
    const dependents = new Map<number, number[]>();
    subtasks.forEach((subtask, dependentIndex) => {
      new Set(subtask.depends_on_indices ?? []).forEach((dependencyIndex) => {
        if (dependencyIndex < 0 || dependencyIndex >= subtasks.length) return;
        dependents.set(dependencyIndex, [
          ...(dependents.get(dependencyIndex) ?? []),
          dependentIndex,
        ]);
      });
    });
    const remove = (candidate: number, visited: Set<number>) => {
      if (visited.has(candidate)) return;
      visited.add(candidate);
      next.delete(candidate);
      dependents.get(candidate)?.forEach((dependent) => remove(dependent, visited));
    };
    remove(index, new Set());
    return next;
  }

  const include = (candidate: number, visited: Set<number>) => {
    if (candidate < 0 || candidate >= subtasks.length || visited.has(candidate)) return;
    visited.add(candidate);
    next.add(candidate);
    new Set(subtasks[candidate].depends_on_indices ?? []).forEach((dependency) => {
      include(dependency, visited);
    });
  };
  include(index, new Set());
  return next;
}
