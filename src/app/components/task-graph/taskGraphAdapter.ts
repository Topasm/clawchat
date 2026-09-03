import { MarkerType, Position, type Edge } from '@xyflow/react';
import type { TaskGraphInsightNode, TodoResponse } from '../../types/api';
import { buildExecutionGraphLayout, buildStructureGraphLayout } from './taskGraphLayout';
import type { GraphRelationshipLike } from './taskGraphLayout';
import type { TaskFlowNode, TaskGraphMode } from './taskGraphTypes';

export interface TaskGraphElements {
  nodes: TaskFlowNode[];
  edges: Edge[];
}

interface AugmentTaskGraphTodosOptions {
  includeAllMissing: boolean;
  includeContextMissing: boolean;
}

/** Build the minimum Todo shape needed to render a node owned by the insight snapshot. */
export function todoFromGraphInsight(
  insight: TaskGraphInsightNode,
  generatedAt: string,
): TodoResponse {
  return {
    id: insight.task_id,
    title: insight.title,
    status: insight.status,
    due_date: insight.due_date,
    tags: [],
    parent_id: insight.parent_id,
    source: 'graph_insight',
    project_label: insight.scope_role === 'context' ? 'External prerequisite' : 'Graph snapshot',
    estimated_minutes: insight.estimated_minutes,
    created_at: generatedAt,
    updated_at: generatedAt,
  };
}

/**
 * Fill client pagination gaps from the authoritative insight snapshot. When
 * external filters are active, only prerequisite context is restored.
 */
export function augmentTaskGraphTodos(
  todos: readonly TodoResponse[],
  metadataTodos: readonly TodoResponse[],
  insightNodes: readonly TaskGraphInsightNode[],
  generatedAt: string,
  options: AugmentTaskGraphTodosOptions,
): TodoResponse[] {
  const result = [...todos];
  const includedIds = new Set(result.map((todo) => todo.id));
  const metadataById = new Map(metadataTodos.map((todo) => [todo.id, todo]));

  insightNodes.forEach((insight) => {
    if (includedIds.has(insight.task_id)) return;
    if (
      !options.includeAllMissing &&
      !(options.includeContextMissing && insight.scope_role === 'context')
    ) {
      return;
    }
    result.push(metadataById.get(insight.task_id) ?? todoFromGraphInsight(insight, generatedAt));
    includedIds.add(insight.task_id);
  });
  return result;
}

/** Merge paginated relationship rows with direct dependencies embedded in the snapshot. */
export function mergeExecutionRelationships(
  relationships: readonly GraphRelationshipLike[],
  insightNodes: readonly TaskGraphInsightNode[],
): GraphRelationshipLike[] {
  const merged: GraphRelationshipLike[] = [];
  const relationshipKeys = new Set<string>();
  const append = (relationship: GraphRelationshipLike) => {
    const key = `${relationship.type}:${relationship.source_task_id}:${relationship.target_task_id}`;
    if (relationshipKeys.has(key)) return;
    relationshipKeys.add(key);
    merged.push(relationship);
  };

  relationships.forEach(append);
  insightNodes.forEach((insight) => {
    insight.dependency_ids.forEach((dependencyId) => {
      append({
        id: `insight-dependency:${insight.task_id}:${dependencyId}`,
        source_task_id: insight.task_id,
        target_task_id: dependencyId,
        type: 'depends_on',
      });
    });
  });
  return merged;
}

interface TaskGraphAdapterOptions {
  mode: TaskGraphMode;
  collapsedIds: ReadonlySet<string>;
  hideCompleted: boolean;
  relationships: readonly GraphRelationshipLike[];
  metadataTodos?: TodoResponse[];
  insightNodes?: readonly TaskGraphInsightNode[];
  criticalPathTaskIds?: readonly string[];
  onToggleCollapse: (taskId: string) => void;
}

/**
 * Keep structural ancestors and the full prerequisite chain for matched tasks.
 * This prevents search/tag/status filters from turning valid relationships into
 * disconnected nodes while preserving the source ordering.
 */
export function expandTaskGraphContext(
  allTodos: TodoResponse[],
  matchedTodos: TodoResponse[],
  relationships: readonly GraphRelationshipLike[],
): TodoResponse[] {
  if (matchedTodos.length === 0) return [];

  const todoById = new Map(allTodos.map((todo) => [todo.id, todo]));
  const includedIds = new Set<string>();
  const dependenciesByTaskId = new Map<string, string[]>();
  relationships.forEach((relationship) => {
    if (relationship.type !== 'depends_on') return;
    const dependencies = dependenciesByTaskId.get(relationship.source_task_id);
    if (dependencies) dependencies.push(relationship.target_task_id);
    else dependenciesByTaskId.set(relationship.source_task_id, [relationship.target_task_id]);
  });

  const pendingIds = matchedTodos.map((todo) => todo.id);
  while (pendingIds.length > 0) {
    const id = pendingIds.pop()!;
    if (includedIds.has(id)) continue;
    const todo = todoById.get(id);
    if (!todo) continue;

    includedIds.add(id);
    if (todo.parent_id) pendingIds.push(todo.parent_id);
    dependenciesByTaskId.get(id)?.forEach((dependencyId) => pendingIds.push(dependencyId));
  }
  return allTodos.filter((todo) => includedIds.has(todo.id));
}

/** Convert the existing TodoResponse model into read-only React Flow data. */
export function buildTaskGraphElements(
  todos: TodoResponse[],
  options: TaskGraphAdapterOptions,
): TaskGraphElements {
  const sourceTodos = options.hideCompleted
    ? todos.filter((todo) => todo.status !== 'completed')
    : todos;
  const sourceIds = new Set(sourceTodos.map((todo) => todo.id));
  const visibleChildrenById = new Map<string, TodoResponse[]>();
  sourceTodos.forEach((todo) => {
    if (!todo.parent_id || !sourceIds.has(todo.parent_id)) return;
    const children = visibleChildrenById.get(todo.parent_id) ?? [];
    children.push(todo);
    visibleChildrenById.set(todo.parent_id, children);
  });

  const metadataTodos = options.metadataTodos ?? todos;
  const metadataChildrenById = new Map<string, TodoResponse[]>();
  metadataTodos.forEach((todo) => {
    if (!todo.parent_id) return;
    const children = metadataChildrenById.get(todo.parent_id) ?? [];
    children.push(todo);
    metadataChildrenById.set(todo.parent_id, children);
  });

  const layout =
    options.mode === 'structure'
      ? buildStructureGraphLayout(sourceTodos, options.collapsedIds)
      : buildExecutionGraphLayout(sourceTodos, options.relationships, options.collapsedIds);
  const todoById = new Map(sourceTodos.map((todo) => [todo.id, todo]));
  const insightByTaskId = new Map(
    (options.insightNodes ?? []).map((insight) => [insight.task_id, insight]),
  );
  const dependencyCountByTaskId = new Map<string, number>();
  options.relationships.forEach((relationship) => {
    if (relationship.type !== 'depends_on') return;
    dependencyCountByTaskId.set(
      relationship.source_task_id,
      (dependencyCountByTaskId.get(relationship.source_task_id) ?? 0) + 1,
    );
  });

  const nodes: TaskFlowNode[] = layout.nodes.flatMap((position) => {
    const todo = todoById.get(position.id);
    if (!todo) return [];
    const children = metadataChildrenById.get(todo.id) ?? [];
    return [
      {
        id: todo.id,
        type: 'task',
        position: { x: position.x, y: position.y },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          todo,
          status: todo.status,
          mode: options.mode,
          childCount: children.length,
          completedChildCount: children.filter((child) => child.status === 'completed').length,
          dependencyCount: dependencyCountByTaskId.get(todo.id) ?? 0,
          hasVisibleChildren: (visibleChildrenById.get(todo.id)?.length ?? 0) > 0,
          isCollapsed: options.collapsedIds.has(todo.id),
          insight: insightByTaskId.get(todo.id),
          onToggleCollapse: options.onToggleCollapse,
        },
      },
    ];
  });

  const criticalPathPairs = new Set<string>();
  for (let index = 1; index < (options.criticalPathTaskIds?.length ?? 0); index += 1) {
    const previousId = options.criticalPathTaskIds![index - 1];
    const currentId = options.criticalPathTaskIds![index];
    criticalPathPairs.add(`${previousId}:${currentId}`);
    criticalPathPairs.add(`${currentId}:${previousId}`);
  }

  const edges: Edge[] = layout.edges.map((edge) => {
    const isCriticalPath =
      edge.type === 'dependency' && criticalPathPairs.has(`${edge.sourceId}:${edge.targetId}`);
    return {
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      type: 'smoothstep',
      className: `cc-task-flow__edge cc-task-flow__edge--${edge.type}${isCriticalPath ? ' cc-task-flow__edge--critical' : ''}`,
      markerEnd:
        edge.type === 'dependency'
          ? { type: MarkerType.ArrowClosed, width: 18, height: 18 }
          : undefined,
      selectable: false,
      focusable: false,
    };
  });

  return { nodes, edges };
}
