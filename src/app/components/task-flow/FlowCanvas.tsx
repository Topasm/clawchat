import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { layoutFlow } from '../task-graph/taskGraphLayout';
import { translateUi } from '../../i18n';

export type FlowTone =
  'done' | 'active' | 'ready' | 'waiting' | 'blocked' | 'proposed' | 'excluded';

export interface FlowNode {
  id: string;
  title: string;
  /** Second line: state, due date, steps inside. */
  meta?: string;
  tone: FlowTone;
  sortOrder?: number;
  /** A stand-in box (folded done steps): selectable, not draggable or checkable. */
  fixed?: boolean;
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
  /** Drawn left of the flow: prerequisites from outside it. */
  lead?: ReactNode;
  /** The dashed box after the last column, where the next step is typed. */
  tail?: ReactNode;
  /** The row the tail sits on (the selected branch end's), default the first. */
  tailAfterId?: string | null;
  /** Brought into view when the flow opens (the step in progress). */
  focusId?: string | null;
}

const W = 168;
const H = 56;
const COL_GAP = 40;
const ROW_GAP = 12;

const left = (column: number) => column * (W + COL_GAP);
const top = (row: number) => row * (H + ROW_GAP);

/**
 * One layer of a flow, left to right: a box per step and a line from each
 * prerequisite to the step that waits on it. Positions come from the order
 * alone, so nothing is saved and there is nothing to reset or zoom; the flow
 * scrolls sideways when it is wide.
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
  tailAfterId,
  focusId,
}: FlowCanvasProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layout = layoutFlow(nodes, edges);
  const place = new Map(layout.placements.map((p) => [p.id, p]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const tailRow = (tailAfterId && place.get(tailAfterId)?.row) || 0;
  const columns = layout.columns + (tail ? 1 : 0);
  const rows = Math.max(layout.rows, tail ? tailRow + 1 : 0);
  const width = columns > 0 ? left(columns - 1) + W : 0;
  const height = rows > 0 ? top(rows - 1) + H : 0;
  const focusColumn = focusId ? place.get(focusId)?.column : undefined;

  // Open with the current step in view; follow the tail when a step is added.
  useLayoutEffect(() => {
    if (focusColumn !== undefined && scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, left(focusColumn) - 24);
    }
  }, [focusColumn]);
  const count = useRef(nodes.length);
  useEffect(() => {
    if (nodes.length > count.current && tail && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
    count.current = nodes.length;
  }, [nodes.length, tail]);

  const box = (node: FlowNode, style?: CSSProperties) => {
    const selected = node.id === selectedId;
    const movable = Boolean(onMove) && !node.fixed;
    return (
      <div
        key={node.id}
        role="listitem"
        className={`cc-flow__box cc-flow__box--${node.tone}${selected ? ' cc-flow__box--selected' : ''}${dragId && dragId !== node.id && !node.fixed ? ' cc-flow__box--drop' : ''}`}
        style={style}
        draggable={movable}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', node.id);
          event.dataTransfer.effectAllowed = 'move';
          setDragId(node.id);
        }}
        onDragEnd={() => setDragId(null)}
        onDragOver={(event) => {
          if (dragId && dragId !== node.id && !node.fixed) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const moved = event.dataTransfer.getData('text/plain') || dragId;
          setDragId(null);
          if (moved && moved !== node.id && !node.fixed) onMove?.(moved, node.id);
        }}
      >
        {onToggle && !node.fixed && (
          <button
            type="button"
            className="cc-flow__check"
            aria-pressed={node.tone === 'done'}
            aria-label={translateUi(
              node.tone === 'done' ? 'Mark {{title}} incomplete' : 'Mark {{title}} complete',
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
  };

  return (
    <div className="cc-flow__body">
      <div className="cc-flow__row">
        {lead}
        <div className="cc-flow__scroll" ref={scrollRef}>
          <div
            className="cc-flow__canvas"
            role="list"
            aria-label={ariaLabel}
            style={{ width, height }}
          >
            {layout.edges.map((edge) => {
              const from = place.get(edge.before);
              const to = place.get(edge.after);
              if (!from || !to) return null;
              const x1 = left(from.column) + W;
              const y1 = top(from.row) + H / 2;
              const x2 = left(to.column);
              const y2 = top(to.row) + H / 2;
              const bend = x2 - COL_GAP / 2;
              return (
                <span key={`${edge.before}>${edge.after}`} aria-hidden="true">
                  {y1 === y2 ? (
                    <i className="cc-flow__line" style={{ left: x1, top: y1, width: x2 - x1 }} />
                  ) : (
                    <>
                      <i
                        className="cc-flow__line"
                        style={{ left: x1, top: y1, width: bend - x1 }}
                      />
                      <i
                        className="cc-flow__line cc-flow__line--down"
                        style={{ left: bend, top: Math.min(y1, y2), height: Math.abs(y2 - y1) }}
                      />
                      <i
                        className="cc-flow__line"
                        style={{ left: bend, top: y2, width: x2 - bend }}
                      />
                    </>
                  )}
                  <i className="cc-flow__arrow" style={{ left: x2 - 6, top: y2 - 4 }} />
                </span>
              );
            })}
            {layout.placements.map((p) =>
              box(nodeById.get(p.id)!, {
                position: 'absolute',
                left: left(p.column),
                top: top(p.row),
                width: W,
                height: H,
              }),
            )}
            {tail && (
              <div
                className="cc-flow__tail"
                style={{ left: left(layout.columns), top: top(tailRow), width: W, height: H }}
              >
                {tail}
              </div>
            )}
          </div>
        </div>
      </div>
      {layout.unordered.length > 0 && (
        <div className="cc-flow__unordered">
          <span className="cc-flow__unordered-label">{translateUi('No order yet')}</span>
          <div
            className="cc-flow__unordered-boxes"
            role="list"
            aria-label={translateUi('No order yet')}
          >
            {layout.unordered.map((id) => box(nodeById.get(id)!, { width: W, height: H }))}
          </div>
        </div>
      )}
    </div>
  );
}
