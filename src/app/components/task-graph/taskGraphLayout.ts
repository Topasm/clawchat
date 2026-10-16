export interface FlowLayoutNode {
  id: string;
  sortOrder?: number;
}

/** `before` must finish before `after` starts. */
export interface FlowLayoutEdge {
  before: string;
  after: string;
}

export interface FlowPlacement {
  id: string;
  column: number;
  row: number;
}

export interface FlowLayout {
  placements: FlowPlacement[];
  /** Steps with no order to any other step; they sit apart from the flow. */
  unordered: string[];
  edges: FlowLayoutEdge[];
  columns: number;
  rows: number;
}

function byOrder(a: FlowLayoutNode, b: FlowLayoutNode) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id);
}

/**
 * Place a flow's steps on a grid, left to right, from order alone.
 *
 * - Column: the longest chain of prerequisites before the step.
 * - Row: a step's first (nearest) successor stays on its row, later successors
 *   (branches) take the next free row below, and a join takes the topmost row
 *   among the steps it follows, so the main line runs straight.
 * - Steps with no order at all are listed apart, not stacked in column 1. A
 *   lone step is the start of the flow, not unordered.
 *
 * Nothing about the layout is stored: the same order always lays out the same.
 */
export function layoutFlow(
  nodes: readonly FlowLayoutNode[],
  edges: readonly FlowLayoutEdge[],
): FlowLayout {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const valid = edges.filter((edge) => {
    const key = `${edge.before}>${edge.after}`;
    if (edge.before === edge.after || !byId.has(edge.before) || !byId.has(edge.after)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const linked = new Set(valid.flatMap((edge) => [edge.before, edge.after]));
  if (linked.size === 0 && nodes.length === 1) linked.add(nodes[0].id);
  const flowNodes = nodes.filter((node) => linked.has(node.id)).sort(byOrder);
  const unordered = nodes
    .filter((node) => !linked.has(node.id))
    .sort(byOrder)
    .map((node) => node.id);

  const before = new Map<string, string[]>();
  const after = new Map<string, FlowLayoutNode[]>();
  for (const edge of valid) {
    before.set(edge.after, [...(before.get(edge.after) ?? []), edge.before]);
    after.set(edge.before, [...(after.get(edge.before) ?? []), byId.get(edge.after)!]);
  }

  // Column = longest prerequisite chain (Kahn's order over the flow).
  const column = new Map(flowNodes.map((node) => [node.id, 0]));
  const waiting = new Map(flowNodes.map((node) => [node.id, before.get(node.id)?.length ?? 0]));
  const queue = flowNodes.filter((node) => waiting.get(node.id) === 0).map((node) => node.id);
  const placed = new Set<string>();
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    placed.add(id);
    for (const next of after.get(id) ?? []) {
      column.set(next.id, Math.max(column.get(next.id)!, column.get(id)! + 1));
      waiting.set(next.id, waiting.get(next.id)! - 1);
      if (waiting.get(next.id) === 0) queue.push(next.id);
    }
  }
  // A cycle cannot be ordered; keep its steps visible to the right.
  let fallback = Math.max(0, ...column.values()) + 1;
  for (const node of flowNodes) {
    if (!placed.has(node.id)) column.set(node.id, fallback++);
  }

  // A step's "first" successor is the nearest one, so the longest chain is
  // the straight line and a shortcut to a later step reads as the branch.
  after.forEach((list) =>
    list.sort((a, b) => column.get(a.id)! - column.get(b.id)! || byOrder(a, b)),
  );
  const ordered = flowNodes
    .map((node) => node.id)
    .sort((a, b) => column.get(a)! - column.get(b)! || byOrder(byId.get(a)!, byId.get(b)!));
  const row = new Map<string, number>();
  const taken = new Map<number, Set<number>>();
  for (const id of ordered) {
    const preds = (before.get(id) ?? []).filter((pred) => row.has(pred));
    const leading = preds.filter((pred) => after.get(pred)?.[0]?.id === id);
    let candidate =
      leading.length > 0
        ? Math.min(...leading.map((pred) => row.get(pred)!))
        : preds.length > 0
          ? Math.min(...preds.map((pred) => row.get(pred)!)) + 1
          : 0;
    const col = column.get(id)!;
    const used = taken.get(col) ?? new Set<number>();
    while (used.has(candidate)) candidate += 1;
    row.set(id, candidate);
    taken.set(col, used.add(candidate));
  }

  const placements = ordered.map((id) => ({ id, column: column.get(id)!, row: row.get(id)! }));
  return {
    placements,
    unordered,
    edges: valid,
    columns: placements.length ? Math.max(...placements.map((p) => p.column)) + 1 : 0,
    rows: placements.length ? Math.max(...placements.map((p) => p.row)) + 1 : 0,
  };
}
