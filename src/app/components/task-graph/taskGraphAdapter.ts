import { MarkerType, Position, type Edge } from '@xyflow/react';
import type { KanbanStatus, TodoResponse } from '../../types/api';
import { buildExecutionGraphLayout, buildStructureGraphLayout } from './taskGraphLayout';
import type { TaskFlowNode, TaskGraphMode } from './taskGraphTypes';

export interface TaskGraphElements {
  nodes: TaskFlowNode[];
  edges: Edge[];
}

interface TaskGraphAdapterOptions {
  mode: TaskGraphMode;
  collapsedIds: ReadonlySet<string>;
  hideCompleted: boolean;
  kanbanStatuses: Record<string, KanbanStatus>;
  metadataTodos?: TodoResponse[];
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
): TodoResponse[] {
  if (matchedTodos.length === 0) return [];

  const todoById = new Map(allTodos.map((todo) => [todo.id, todo]));
  const includedIds = new Set<string>();

  const include = (id: string, path: ReadonlySet<string>) => {
    if (path.has(id)) return;
    const todo = todoById.get(id);
    if (!todo) return;

    includedIds.add(id);
    const nextPath = new Set(path);
    nextPath.add(id);

    if (todo.parent_id) include(todo.parent_id, nextPath);
    new Set(todo.depends_on ?? []).forEach((dependencyId) => include(dependencyId, nextPath));
  };

  matchedTodos.forEach((todo) => include(todo.id, new Set()));
  return allTodos.filter((todo) => includedIds.has(todo.id));
}

/** Convert the existing TodoResponse model into read-only React Flow data. */
export function buildTaskGraphElements(
  todos: TodoResponse[],
  options: TaskGraphAdapterOptions,
): TaskGraphElements {
  const effectiveStatus = (todo: TodoResponse): KanbanStatus =>
    options.kanbanStatuses[todo.id] ?? (todo.status as KanbanStatus);

  const sourceTodos = options.hideCompleted
    ? todos.filter((todo) => effectiveStatus(todo) !== 'completed')
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

  const layout = options.mode === 'structure'
    ? buildStructureGraphLayout(sourceTodos, options.collapsedIds)
    : buildExecutionGraphLayout(sourceTodos, options.collapsedIds);
  const todoById = new Map(sourceTodos.map((todo) => [todo.id, todo]));

  const nodes: TaskFlowNode[] = layout.nodes.flatMap((position) => {
    const todo = todoById.get(position.id);
    if (!todo) return [];
    const children = metadataChildrenById.get(todo.id) ?? [];
    return [{
      id: todo.id,
      type: 'task',
      position: { x: position.x, y: position.y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        todo,
        status: effectiveStatus(todo),
        mode: options.mode,
        childCount: children.length,
        completedChildCount: children.filter((child) => effectiveStatus(child) === 'completed').length,
        hasVisibleChildren: (visibleChildrenById.get(todo.id)?.length ?? 0) > 0,
        isCollapsed: options.collapsedIds.has(todo.id),
        onToggleCollapse: options.onToggleCollapse,
      },
    }];
  });

  const edges: Edge[] = layout.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    type: 'smoothstep',
    className: `cc-task-flow__edge cc-task-flow__edge--${edge.type}`,
    markerEnd: edge.type === 'dependency'
      ? { type: MarkerType.ArrowClosed, width: 18, height: 18 }
      : undefined,
    selectable: false,
    focusable: false,
  }));

  return { nodes, edges };
}
