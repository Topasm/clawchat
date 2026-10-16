import type { PlanSubtask } from '../../types/api';
import type { FlowEdge } from '../task-flow/FlowCanvas';

export function proposalNodeId(index: number) {
  return `proposal:subtask:${index}`;
}

export function proposalIndexFromNodeId(nodeId: string): number | null {
  const prefix = 'proposal:subtask:';
  if (!nodeId.startsWith(prefix)) return null;
  const index = Number(nodeId.slice(prefix.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** Prerequisite → dependent arrows between proposed steps, skipping bad indices. */
export function buildProposalEdges(subtasks: PlanSubtask[]): FlowEdge[] {
  return subtasks.flatMap((subtask, index) =>
    [...new Set(subtask.depends_on_indices ?? [])].flatMap((dependencyIndex) =>
      dependencyIndex < 0 || dependencyIndex >= subtasks.length || dependencyIndex === index
        ? []
        : [{ before: proposalNodeId(dependencyIndex), after: proposalNodeId(index) }],
    ),
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
