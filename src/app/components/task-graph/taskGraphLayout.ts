export const GRAPH_NODE_WIDTH = 244;
export const GRAPH_NODE_HEIGHT = 118;
export const GRAPH_COLUMN_GAP = 104;
export const GRAPH_ROW_GAP = 28;
export const GRAPH_CANVAS_PADDING = 32;

export interface GraphTaskLike {
  id: string;
  title: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface GraphRelationshipLike {
  id?: string;
  source_task_id: string;
  target_task_id: string;
  type: string;
}

export interface TaskGraphNodeLayout {
  id: string;
  x: number;
  y: number;
}

export interface TaskGraphEdgeLayout {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'hierarchy' | 'dependency';
}

export interface TaskGraphLayout {
  nodes: TaskGraphNodeLayout[];
  edges: TaskGraphEdgeLayout[];
  width: number;
  height: number;
}

function taskOrder(a: GraphTaskLike, b: GraphTaskLike) {
  const sortDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  return sortDiff || a.title.localeCompare(b.title);
}

function canvasSize(nodes: TaskGraphNodeLayout[]): Pick<TaskGraphLayout, 'width' | 'height'> {
  if (nodes.length === 0) return { width: 0, height: 0 };
  return {
    width:
      nodes.reduce((max, node) => Math.max(max, node.x + GRAPH_NODE_WIDTH), 0) +
      GRAPH_CANVAS_PADDING,
    height:
      nodes.reduce((max, node) => Math.max(max, node.y + GRAPH_NODE_HEIGHT), 0) +
      GRAPH_CANVAS_PADDING,
  };
}

/** Remove descendants hidden by collapsed structural parent nodes. */
export function filterCollapsedTasks(
  tasks: GraphTaskLike[],
  collapsedIds: ReadonlySet<string>,
): GraphTaskLike[] {
  if (collapsedIds.size === 0) return tasks;

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return tasks.filter((task) => {
    const visited = new Set<string>([task.id]);
    let parentId = task.parent_id;
    while (parentId && taskById.has(parentId) && !visited.has(parentId)) {
      if (collapsedIds.has(parentId)) return false;
      visited.add(parentId);
      parentId = taskById.get(parentId)?.parent_id;
    }
    return true;
  });
}

/** Layout the structural parent/child forest from left to right. */
export function buildStructureGraphLayout(
  tasks: GraphTaskLike[],
  collapsedIds: ReadonlySet<string> = new Set(),
): TaskGraphLayout {
  const visibleTasks = filterCollapsedTasks(tasks, collapsedIds);
  if (visibleTasks.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const taskById = new Map(visibleTasks.map((task) => [task.id, task]));
  const childrenById = new Map<string, GraphTaskLike[]>();
  visibleTasks.forEach((task) => {
    if (!task.parent_id || task.parent_id === task.id || !taskById.has(task.parent_id)) return;
    const children = childrenById.get(task.parent_id) ?? [];
    children.push(task);
    childrenById.set(task.parent_id, children);
  });
  childrenById.forEach((children) => children.sort(taskOrder));

  const subtreeHeightMemo = new Map<string, number>();
  const measureSubtree = (id: string, ancestors: ReadonlySet<string>): number => {
    const memoized = subtreeHeightMemo.get(id);
    if (memoized !== undefined) return memoized;
    if (ancestors.has(id) || collapsedIds.has(id)) return GRAPH_NODE_HEIGHT;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    const children = (childrenById.get(id) ?? []).filter((child) => !nextAncestors.has(child.id));
    if (children.length === 0) return GRAPH_NODE_HEIGHT;

    const height = children.reduce(
      (total, child, index) =>
        total + measureSubtree(child.id, nextAncestors) + (index > 0 ? GRAPH_ROW_GAP : 0),
      0,
    );
    const measured = Math.max(GRAPH_NODE_HEIGHT, height);
    subtreeHeightMemo.set(id, measured);
    return measured;
  };

  const nodes: TaskGraphNodeLayout[] = [];
  const placed = new Set<string>();
  const placeSubtree = (id: string, depth: number, top: number, ancestors: ReadonlySet<string>) => {
    if (placed.has(id) || ancestors.has(id)) return;
    const subtreeHeight = measureSubtree(id, ancestors);
    nodes.push({
      id,
      x: GRAPH_CANVAS_PADDING + depth * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP),
      y: top + (subtreeHeight - GRAPH_NODE_HEIGHT) / 2,
    });
    placed.add(id);
    if (collapsedIds.has(id)) return;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    let childTop = top;
    for (const child of childrenById.get(id) ?? []) {
      if (nextAncestors.has(child.id)) continue;
      placeSubtree(child.id, depth + 1, childTop, nextAncestors);
      childTop += measureSubtree(child.id, nextAncestors) + GRAPH_ROW_GAP;
    }
  };

  const roots = visibleTasks
    .filter(
      (task) => !task.parent_id || task.parent_id === task.id || !taskById.has(task.parent_id),
    )
    .sort(taskOrder);
  let forestTop = GRAPH_CANVAS_PADDING;
  const placeRoot = (root: GraphTaskLike) => {
    const height = measureSubtree(root.id, new Set());
    placeSubtree(root.id, 0, forestTop, new Set());
    forestTop += height + GRAPH_ROW_GAP * 2;
  };
  roots.forEach(placeRoot);
  // Rootless cyclic components are still rendered rather than silently lost.
  visibleTasks
    .filter((task) => !placed.has(task.id))
    .sort(taskOrder)
    .forEach(placeRoot);

  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges: TaskGraphEdgeLayout[] = visibleTasks.flatMap((task) => {
    if (
      !task.parent_id ||
      !visibleIds.has(task.id) ||
      !visibleIds.has(task.parent_id) ||
      task.id === task.parent_id
    ) {
      return [];
    }
    return [
      {
        id: `hierarchy:${task.parent_id}:${task.id}`,
        sourceId: task.parent_id,
        targetId: task.id,
        type: 'hierarchy' as const,
      },
    ];
  });

  return { nodes, edges, ...canvasSize(nodes) };
}

/** Layout the dependency DAG into execution stages using topological depth. */
export function buildExecutionGraphLayout(
  tasks: GraphTaskLike[],
  relationships: readonly GraphRelationshipLike[],
  collapsedIds: ReadonlySet<string> = new Set(),
): TaskGraphLayout {
  const visibleTasks = filterCollapsedTasks(tasks, collapsedIds);
  if (visibleTasks.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const taskById = new Map(visibleTasks.map((task) => [task.id, task]));
  const incomingCount = new Map(visibleTasks.map((task) => [task.id, 0]));
  const outgoing = new Map<string, Set<string>>();
  const edges: TaskGraphEdgeLayout[] = [];
  const seenRelationships = new Set<string>();

  relationships.forEach((relationship) => {
    if (relationship.type !== 'depends_on') return;
    const taskId = relationship.source_task_id;
    const dependencyId = relationship.target_task_id;
    const relationshipKey = `${taskId}:${dependencyId}`;
    if (
      dependencyId === taskId ||
      !taskById.has(taskId) ||
      !taskById.has(dependencyId) ||
      seenRelationships.has(relationshipKey)
    ) {
      return;
    }
    seenRelationships.add(relationshipKey);
    outgoing.set(dependencyId, (outgoing.get(dependencyId) ?? new Set()).add(taskId));
    incomingCount.set(taskId, (incomingCount.get(taskId) ?? 0) + 1);
    edges.push({
      id: `dependency:${dependencyId}:${taskId}`,
      sourceId: dependencyId,
      targetId: taskId,
      type: 'dependency',
    });
  });

  const depth = new Map(visibleTasks.map((task) => [task.id, 0]));
  const queue = visibleTasks
    .filter((task) => incomingCount.get(task.id) === 0)
    .sort(taskOrder)
    .map((task) => task.id);
  const processed = new Set<string>();
  let queueHead = 0;

  while (queueHead < queue.length) {
    const id = queue[queueHead++];
    if (processed.has(id)) continue;
    processed.add(id);
    for (const targetId of outgoing.get(id) ?? []) {
      depth.set(targetId, Math.max(depth.get(targetId) ?? 0, (depth.get(id) ?? 0) + 1));
      const nextIncoming = (incomingCount.get(targetId) ?? 1) - 1;
      incomingCount.set(targetId, nextIncoming);
      if (nextIncoming === 0) queue.push(targetId);
    }
  }

  // Cycles cannot be topologically sorted. Keep them visible in fallback stages.
  let fallbackDepth = Math.max(0, ...depth.values());
  visibleTasks
    .filter((task) => !processed.has(task.id))
    .sort(taskOrder)
    .forEach((task) => {
      depth.set(task.id, fallbackDepth++);
    });

  const columns = new Map<number, GraphTaskLike[]>();
  visibleTasks.forEach((task) => {
    const columnDepth = depth.get(task.id) ?? 0;
    const column = columns.get(columnDepth) ?? [];
    column.push(task);
    columns.set(columnDepth, column);
  });
  columns.forEach((column) => column.sort(taskOrder));

  const nodes: TaskGraphNodeLayout[] = [];
  [...columns.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([columnDepth, column]) => {
      column.forEach((task, row) => {
        nodes.push({
          id: task.id,
          x: GRAPH_CANVAS_PADDING + columnDepth * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP),
          y: GRAPH_CANVAS_PADDING + row * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP),
        });
      });
    });

  return { nodes, edges, ...canvasSize(nodes) };
}

export const buildTaskGraphLayout = buildStructureGraphLayout;
