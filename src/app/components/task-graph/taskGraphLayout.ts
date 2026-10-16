export interface GraphLayoutSize {
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
  padding: number;
}

const DEFAULT_SIZE: GraphLayoutSize = {
  nodeWidth: 244,
  nodeHeight: 118,
  columnGap: 104,
  rowGap: 28,
  padding: 32,
};

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

interface TaskGraphNodeLayout {
  id: string;
  x: number;
  y: number;
}

interface TaskGraphEdgeLayout {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'dependency';
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

function canvasSize(
  nodes: TaskGraphNodeLayout[],
  size: GraphLayoutSize,
): Pick<TaskGraphLayout, 'width' | 'height'> {
  if (nodes.length === 0) return { width: 0, height: 0 };
  return {
    width: nodes.reduce((max, node) => Math.max(max, node.x + size.nodeWidth), 0) + size.padding,
    height: nodes.reduce((max, node) => Math.max(max, node.y + size.nodeHeight), 0) + size.padding,
  };
}

/** Layout the dependency DAG into execution stages using topological depth. */
export function buildExecutionGraphLayout(
  visibleTasks: GraphTaskLike[],
  relationships: readonly GraphRelationshipLike[],
  size: GraphLayoutSize = DEFAULT_SIZE,
): TaskGraphLayout {
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
          x: size.padding + columnDepth * (size.nodeWidth + size.columnGap),
          y: size.padding + row * (size.nodeHeight + size.rowGap),
        });
      });
    });

  return { nodes, edges, ...canvasSize(nodes, size) };
}
