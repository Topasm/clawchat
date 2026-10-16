import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAddTaskStep,
  useMoveTaskStep,
  useTaskRelationshipsQuery,
  useTodosQuery,
  useToggleTodoComplete,
} from '../../hooks/queries';
import type { TodoResponse } from '../../types/api';
import { formatDueDate } from '../../utils/formatters';
import { translateUi } from '../../i18n';
import FlowCanvas, { type FlowEdge, type FlowNode, type FlowTone } from './FlowCanvas';

interface TaskFlowProps {
  /** The task whose steps are drawn; a box with steps of its own drills in. */
  rootId: string;
  /** Selection is lifted when a parent shows actions for the selected step. */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

const TONE_LABELS: Record<FlowTone, string> = {
  done: 'Done',
  active: 'In progress',
  ready: 'Ready',
  waiting: 'Waiting',
  blocked: 'Blocked',
  proposed: '',
  excluded: '',
};

function byOrder(left: TodoResponse, right: TodoResponse) {
  return (
    (left.sort_order ?? 0) - (right.sort_order ?? 0) ||
    left.created_at.localeCompare(right.created_at)
  );
}

/** How many of a task's direct steps are done, for "3/5 steps". */
export function stepProgress(todos: readonly TodoResponse[], parentId: string) {
  const steps = todos.filter((todo) => todo.parent_id === parentId && todo.status !== 'cancelled');
  return { done: steps.filter((todo) => todo.status === 'completed').length, total: steps.length };
}

/**
 * The steps of one task: its direct children as boxes and the order between
 * them as arrows. Steps typed in a row form a chain; Tab forks a branch.
 */
export default function TaskFlow({ rootId, selectedId: controlledId, onSelect }: TaskFlowProps) {
  const navigate = useNavigate();
  const { data: todos = [] } = useTodosQuery();
  const { data: relationships = [] } = useTaskRelationshipsQuery();
  const addStep = useAddTaskStep();
  const moveStep = useMoveTaskStep();
  const toggle = useToggleTodoComplete();
  const [scopeId, setScopeId] = useState(rootId);
  const [localId, setLocalId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Steps are appended after the flow's current end, which the server reads
  // when the request lands; one at a time keeps a typed run a chain.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const selectedId = controlledId === undefined ? localId : controlledId;
  const select = (id: string | null) => (onSelect ? onSelect(id) : setLocalId(id));

  useEffect(() => {
    setScopeId(rootId);
    setLocalId(null);
  }, [rootId]);

  const todoById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const steps = useMemo(
    () => todos.filter((todo) => todo.parent_id === scopeId).sort(byOrder),
    [scopeId, todos],
  );
  const stepIds = useMemo(() => new Set(steps.map((step) => step.id)), [steps]);
  const childCount = useMemo(() => {
    const counts = new Map<string, { done: number; total: number }>();
    for (const todo of todos) {
      if (!todo.parent_id || !stepIds.has(todo.parent_id) || todo.status === 'cancelled') continue;
      const entry = counts.get(todo.parent_id) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (todo.status === 'completed') entry.done += 1;
      counts.set(todo.parent_id, entry);
    }
    return counts;
  }, [stepIds, todos]);

  const { edges, outside, prerequisites } = useMemo(() => {
    const inner: FlowEdge[] = [];
    const outer = new Map<string, TodoResponse>();
    const before = new Map<string, string[]>();
    for (const relationship of relationships) {
      if (relationship.type !== 'depends_on' || !stepIds.has(relationship.source_task_id)) continue;
      const target = relationship.target_task_id;
      before.set(relationship.source_task_id, [
        ...(before.get(relationship.source_task_id) ?? []),
        target,
      ]);
      if (stepIds.has(target)) inner.push({ before: target, after: relationship.source_task_id });
      else {
        const task = todoById.get(target);
        if (task) outer.set(task.id, task);
      }
    }
    return { edges: inner, outside: [...outer.values()], prerequisites: before };
  }, [relationships, stepIds, todoById]);

  const toneOf = (step: TodoResponse): FlowTone => {
    if (step.status === 'completed' || step.status === 'cancelled') return 'done';
    const unfinished = (prerequisites.get(step.id) ?? []).filter(
      (id) => todoById.get(id)?.status !== 'completed',
    );
    if (unfinished.some((id) => !stepIds.has(id))) return 'blocked';
    if (unfinished.length > 0) return 'waiting';
    return step.status === 'in_progress' ? 'active' : 'ready';
  };

  const nodes: FlowNode[] = steps.map((step) => {
    const tone = toneOf(step);
    const inside = childCount.get(step.id);
    const meta = [
      translateUi(TONE_LABELS[tone]),
      inside ? translateUi('{{done}}/{{total}} steps', inside) : '',
      step.due_date && tone !== 'done' ? formatDueDate(step.due_date) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return { id: step.id, title: step.title, meta, tone, sortOrder: step.sort_order ?? 0 };
  });
  const canDoNow = nodes.filter((node) => node.tone === 'ready' || node.tone === 'active').length;
  const blocked = nodes.filter((node) => node.tone === 'blocked').length;

  const trail: TodoResponse[] = [];
  for (let cursor = todoById.get(scopeId); cursor && trail.length < 12;) {
    trail.unshift(cursor);
    if (cursor.id === rootId) break;
    cursor = cursor.parent_id ? todoById.get(cursor.parent_id) : undefined;
  }

  const submit = (branch: boolean) => {
    const title = draft.trim();
    if (!title) return;
    const lastStep = steps[steps.length - 1];
    const branchFromId = branch
      ? selectedId && stepIds.has(selectedId)
        ? selectedId
        : lastStep?.id
      : null;
    const parentId = scopeId;
    setDraft('');
    queue.current = queue.current
      .catch(() => undefined)
      .then(() => addStep.mutateAsync({ parentId, title, branchFromId }))
      .catch(() => undefined);
  };

  const openOrDrill = (id: string) => {
    if (childCount.has(id)) {
      setScopeId(id);
      select(null);
    } else if (id === selectedId) {
      navigate(`/tasks/${id}`);
    } else {
      select(id);
    }
  };

  return (
    <section className="cc-flow" aria-label={translateUi('Flow')}>
      {trail.length > 1 && (
        <nav className="cc-flow__trail" aria-label={translateUi('Flow')}>
          {trail.map((task, index) =>
            index === trail.length - 1 ? (
              <strong key={task.id}>{task.title}</strong>
            ) : (
              <span key={task.id}>
                <button type="button" onClick={() => setScopeId(task.id)}>
                  {task.title}
                </button>
                {' › '}
              </span>
            ),
          )}
        </nav>
      )}
      {steps.length > 0 && (
        <p className="cc-flow__summary">
          {translateUi('Can do now {{ready}} · Blocked {{blocked}}', {
            ready: canDoNow,
            blocked,
          })}
        </p>
      )}
      {steps.length > 0 && (
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          ariaLabel={translateUi('Steps')}
          selectedId={selectedId}
          onSelect={openOrDrill}
          onToggle={(id) => {
            const step = todoById.get(id);
            if (step) toggle.mutate({ id, currentStatus: step.status });
          }}
          onMove={(id, afterId) => moveStep.mutate({ parentId: scopeId, stepId: id, afterId })}
          lead={
            outside.length > 0 && (
              <div className="cc-flow__lead">
                {outside.map((task) => (
                  <button key={task.id} type="button" onClick={() => navigate(`/tasks/${task.id}`)}>
                    {translateUi('Other task: {{title}}', { title: task.title })}
                  </button>
                ))}
              </div>
            )
          }
          tail={
            <button
              type="button"
              className="cc-flow__add"
              aria-label={translateUi('Next step')}
              onClick={() => inputRef.current?.focus()}
            >
              +
            </button>
          }
        />
      )}
      <input
        ref={inputRef}
        className="cc-flow__input"
        value={draft}
        placeholder={translateUi(
          steps.length > 0 ? 'Next step · Enter, branch · Tab' : 'First step · Enter',
        )}
        aria-label={translateUi('Next step')}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            submit(false);
          } else if (event.key === 'Tab' && !event.shiftKey && draft.trim() && steps.length > 0) {
            event.preventDefault();
            submit(true);
          } else if (event.key === 'Escape') {
            select(null);
          }
        }}
      />
    </section>
  );
}
