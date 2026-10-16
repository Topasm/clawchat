import { useState, type ReactNode } from 'react';
import { buildExecutionGraphLayout } from '../task-graph/taskGraphLayout';
import { translateUi } from '../../i18n';

export type FlowTone =
  'done' | 'active' | 'ready' | 'waiting' | 'blocked' | 'proposed' | 'excluded';

export interface FlowNode {
  id: string;
  title: string;
  /** Second line: state, steps inside, due date. */
  meta?: string;
  tone: FlowTone;
  sortOrder?: number;
}

/** `before` must finish before `after` starts. */
export interface FlowEdge {
  before: string;
  after: string;
}

interface FlowCanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  ariaLabel: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Dropping one box on another moves it right after that box. */
  onMove?: (id: string, afterId: string) => void;
  onToggle?: (id: string) => void;
  /** Drawn left of the first column: prerequisites from outside the flow. */
  lead?: ReactNode;
  /** Drawn after the last column, e.g. a + that focuses the step input. */
  tail?: ReactNode;
}

const SIZE = { nodeWidth: 168, nodeHeight: 56, columnGap: 40, rowGap: 12, padding: 4 };

/**
 * One layer of a flow, laid out left to right by order: a box per step, an
 * arrow from each prerequisite to the step that waits on it. Positions come
 * from the order alone, so nothing about the layout is saved.
 */
export default function FlowCanvas({
  nodes,
  edges,
  ariaLabel,
  selectedId,
  onSelect,
  onMove,
  onToggle,
  lead,
  tail,
}: FlowCanvasProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const layout = buildExecutionGraphLayout(
    nodes.map((node) => ({ id: node.id, title: node.title, sort_order: node.sortOrder })),
    edges.map((edge) => ({
      source_task_id: edge.after,
      target_task_id: edge.before,
      type: 'depends_on',
    })),
    SIZE,
  );
  const position = new Map(layout.nodes.map((node) => [node.id, node]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const half = SIZE.nodeHeight / 2;

  return (
    <div className="cc-flow__row">
      {lead}
      <div className="cc-flow__scroll">
        <div
          className="cc-flow__canvas"
          role="list"
          aria-label={ariaLabel}
          style={{ width: layout.width + (tail ? 40 : 0), height: layout.height }}
        >
          <svg
            className="cc-flow__edges"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="cc-flow-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" />
              </marker>
            </defs>
            {layout.edges.map((edge) => {
              const from = position.get(edge.sourceId);
              const to = position.get(edge.targetId);
              if (!from || !to) return null;
              const x1 = from.x + SIZE.nodeWidth;
              const y1 = from.y + half;
              const x2 = to.x;
              const y2 = to.y + half;
              const bend = Math.max(16, (x2 - x1) / 2);
              return (
                <path
                  key={edge.id}
                  d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2 - 1},${y2}`}
                  markerEnd="url(#cc-flow-arrow)"
                />
              );
            })}
          </svg>
          {layout.nodes.map((placed) => {
            const node = nodeById.get(placed.id)!;
            const selected = node.id === selectedId;
            return (
              <div
                key={node.id}
                role="listitem"
                className={`cc-flow__box cc-flow__box--${node.tone}${selected ? ' cc-flow__box--selected' : ''}${dragId && dragId !== node.id ? ' cc-flow__box--drop' : ''}`}
                style={{
                  left: placed.x,
                  top: placed.y,
                  width: SIZE.nodeWidth,
                  height: SIZE.nodeHeight,
                }}
                draggable={Boolean(onMove)}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', node.id);
                  event.dataTransfer.effectAllowed = 'move';
                  setDragId(node.id);
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(event) => {
                  if (dragId && dragId !== node.id) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const moved = event.dataTransfer.getData('text/plain') || dragId;
                  setDragId(null);
                  if (moved && moved !== node.id) onMove?.(moved, node.id);
                }}
              >
                {onToggle && (
                  <button
                    type="button"
                    className="cc-flow__check"
                    aria-pressed={node.tone === 'done'}
                    aria-label={translateUi(
                      node.tone === 'done'
                        ? 'Mark {{title}} incomplete'
                        : 'Mark {{title}} complete',
                      { title: node.title },
                    )}
                    onClick={() => onToggle(node.id)}
                  />
                )}
                <button
                  type="button"
                  className="cc-flow__label"
                  aria-current={selected || undefined}
                  onClick={() => onSelect?.(node.id)}
                >
                  <span className="cc-flow__title">{node.title}</span>
                  {node.meta && <span className="cc-flow__meta">{node.meta}</span>}
                </button>
              </div>
            );
          })}
          {tail && (
            <div
              className="cc-flow__tail"
              style={{ left: layout.width, top: Math.max(0, layout.height / 2 - 14) }}
            >
              {tail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
