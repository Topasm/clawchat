import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  /** A stand-in row (folded done steps): selectable, not draggable or checkable. */
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
  /** Dropping one row on another moves it right after that row. */
  onMove?: (id: string, afterId: string) => void;
  onToggle?: (id: string) => void;
  /** Proposed rows get a title field instead of a label. */
  onRename?: (id: string, title: string) => void;
  /** Proposed rows get a button that leaves them out, or brings them back. */
  onDiscard?: (id: string) => void;
  /** Above the list: prerequisites from outside it. */
  lead?: ReactNode;
  /** The dashed row under the list, where the next step is typed. */
  tail?: ReactNode;
  /** Kept for callers; a list has one end, so the tail always sits below it. */
  tailAfterId?: string | null;
  /** Brought into view when the flow opens (the step in progress). */
  focusId?: string | null;
}

/**
 * The steps of a flow as one checklist, top to bottom, in the order they run.
 *
 * The order comes from `layoutFlow`: a step sits below everything it waits
 * on. Steps that can run side by side (a fork) are indented under the step
 * they branch from, and a row that waits on something other than the row
 * above says so ("after · Read"), so a fork or join is still legible without
 * drawing lines. Titles wrap instead of being cut short.
 */
export default function FlowCanvas({
  nodes,
  edges,
  ariaLabel,
  selectedId,
  onSelect,
  onMove,
  onToggle,
  onRename,
  onDiscard,
  lead,
  tail,
  focusId,
}: FlowCanvasProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const layout = layoutFlow(nodes, edges);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const before = new Map<string, string[]>();
  for (const edge of layout.edges) {
    before.set(edge.after, [...(before.get(edge.after) ?? []), edge.before]);
  }
  const ordered = layout.placements.map((placement) => placement.id);

  // Open with the current step in view; follow the tail when a step is added.
  useEffect(() => {
    if (!focusId || !listRef.current) return;
    listRef.current
      .querySelector<HTMLElement>(`[data-step-id="${focusId}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [focusId]);
  const count = useRef(nodes.length);
  useEffect(() => {
    if (nodes.length > count.current && tail && listRef.current) {
      listRef.current.parentElement
        ?.querySelector<HTMLElement>('.cc-flow__tail')
        ?.scrollIntoView?.({ block: 'nearest' });
    }
    count.current = nodes.length;
  }, [nodes.length, tail]);

  const row = (node: FlowNode, index: number) => {
    const selected = node.id === selectedId;
    const draft = node.tone === 'proposed' || node.tone === 'excluded';
    const fixed = node.fixed || draft;
    const movable = Boolean(onMove) && !fixed;
    const placement = layout.placements[index];
    const branch = placement ? placement.row > 0 : false;
    // Which rows this one waits on, when that is not simply the row above.
    const waits = (before.get(node.id) ?? []).filter((id) => nodeById.has(id));
    const previous = index > 0 ? ordered[index - 1] : null;
    const after =
      waits.length > 0 && !(waits.length === 1 && waits[0] === previous)
        ? waits.map((id) => nodeById.get(id)!.title).join(', ')
        : null;
    const meta = [node.meta, after && translateUi('after · {{title}}', { title: after })]
      .filter(Boolean)
      .join(' · ');
    return (
      <div
        key={node.id}
        role="listitem"
        data-step-id={node.id}
        className={`cc-flow__box cc-flow__box--${node.tone}${selected ? ' cc-flow__box--selected' : ''}${branch ? ' cc-flow__box--branch' : ''}${dragId && dragId !== node.id && !fixed ? ' cc-flow__box--drop' : ''}`}
        draggable={movable}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', node.id);
          event.dataTransfer.effectAllowed = 'move';
          setDragId(node.id);
        }}
        onDragEnd={() => setDragId(null)}
        onDragOver={(event) => {
          if (dragId && dragId !== node.id && !fixed) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const moved = event.dataTransfer.getData('text/plain') || dragId;
          setDragId(null);
          if (moved && moved !== node.id && !fixed) onMove?.(moved, node.id);
        }}
      >
        {onToggle && !fixed ? (
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
        ) : (
          <span className="cc-flow__check cc-flow__check--still" aria-hidden="true" />
        )}
        {draft && onRename ? (
          <span className="cc-flow__label">
            <input
              className="cc-flow__title cc-flow__title-input"
              value={node.title}
              aria-label={translateUi('Step title')}
              onChange={(event) => onRename(node.id, event.target.value)}
            />
            {meta && <span className="cc-flow__meta">{meta}</span>}
          </span>
        ) : (
          <button
            type="button"
            className="cc-flow__label"
            aria-current={selected || undefined}
            onClick={() => onSelect?.(node.id)}
          >
            <span className="cc-flow__title">{node.title}</span>
            {meta && <span className="cc-flow__meta">{meta}</span>}
          </button>
        )}
        {draft && onDiscard && (
          <button
            type="button"
            className="cc-flow__discard"
            aria-label={translateUi(
              node.tone === 'proposed' ? 'Remove {{title}}' : 'Restore {{title}}',
              { title: node.title },
            )}
            onClick={() => onDiscard(node.id)}
          >
            {node.tone === 'proposed' ? '×' : '↺'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="cc-flow__body">
      {lead}
      <div className="cc-flow__list" ref={listRef} role="list" aria-label={ariaLabel}>
        {ordered.map((id, index) => row(nodeById.get(id)!, index))}
      </div>
      {tail && <div className="cc-flow__tail">{tail}</div>}
      {layout.unordered.length > 0 && (
        <div className="cc-flow__unordered">
          <span className="cc-flow__unordered-label">{translateUi('No order yet')}</span>
          <div className="cc-flow__list" role="list" aria-label={translateUi('No order yet')}>
            {layout.unordered.map((id) => row(nodeById.get(id)!, -1))}
          </div>
        </div>
      )}
    </div>
  );
}
