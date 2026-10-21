import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAddTaskStep,
  useMoveTaskStep,
  useTaskRelationshipsQuery,
  useTodosQuery,
  useToggleTodoComplete,
} from '../../hooks/queries';
import type { PlanProposalResponse, TodoResponse } from '../../types/api';
import { useToastStore } from '../../stores/useToastStore';
import { formatDueDate } from '../../utils/formatters';
import { translateUi } from '../../i18n';
import FlowCanvas, { type FlowEdge, type FlowNode, type FlowTone } from './FlowCanvas';
import FlowPrerequisites from './FlowPrerequisites';
import useFlowProposal from './useFlowProposal';

interface TaskFlowProps {
  /** The task whose steps are drawn; a box with steps of its own drills in. */
  rootId: string;
  /** Selection is lifted when a parent shows actions for the selected step. */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** An AI plan for the root task, drawn as dashed boxes until it is added. */
  plan?: PlanProposalResponse | null;
  /** Where a step opens; its own page by default. */
  onOpenTask?: (id: string) => void;
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
const DONE_GROUP = 'flow:done';
const DONE_FOLD_AFTER = 3;

function byOrder(left: TodoResponse, right: TodoResponse) {
  return (
    (left.sort_order ?? 0) - (right.sort_order ?? 0) ||
    left.created_at.localeCompare(right.created_at)
  );
}

/** How many extra paths the flow opens: a step that leads to three adds two. */
export function flowBranchCount(edges: readonly FlowEdge[]): number {
  const next = new Map<string, number>();
  edges.forEach((edge) => next.set(edge.before, (next.get(edge.before) ?? 0) + 1));
  let branches = 0;
  next.forEach((count) => {
    branches += Math.max(0, count - 1);
  });
  return branches;
}

/** Whether `from` already waits, through any chain, on `to`. */
function waitsOn(edges: readonly FlowEdge[], from: string, to: string): boolean {
  const before = new Map<string, string[]>();
  edges.forEach((edge) => before.set(edge.after, [...(before.get(edge.after) ?? []), edge.before]));
  const seen = new Set<string>();
  const pending = [from];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(before.get(id) ?? []));
  }
  return false;
}

/**
 * The steps of one task: its direct children as boxes and the order between
 * them as lines. Steps typed in a row form a chain; Tab forks a branch.
 */
export default function TaskFlow({
  rootId,
  selectedId: controlledId,
  onSelect,
  plan,
  onOpenTask,
}: TaskFlowProps) {
  const navigate = useNavigate();
  const openTask = (id: string) => (onOpenTask ? onOpenTask(id) : navigate(`/tasks/${id}`));
  const { data: todos = [] } = useTodosQuery();
  const { data: relationships = [] } = useTaskRelationshipsQuery();
  const addStep = useAddTaskStep();
  const moveStep = useMoveTaskStep();
  const toggle = useToggleTodoComplete();
  const [scopeId, setScopeId] = useState(rootId);
  const [localId, setLocalId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState('');
  // Steps are placed by where the flow ends when the request lands, so they
  // go one at a time; `anchor` carries a chosen branch end to the next step.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const anchor = useRef<string | null>(null);
  const selectedId = controlledId === undefined ? localId : controlledId;
  const select = (id: string | null) => (onSelect ? onSelect(id) : setLocalId(id));

  useEffect(() => {
    setScopeId(rootId);
    setLocalId(null);
    setShowDone(false);
  }, [rootId]);

  const todoById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const steps = useMemo(
    () => todos.filter((todo) => todo.parent_id === scopeId).sort(byOrder),
    [scopeId, todos],
  );
  const stepIds = useMemo(() => new Set(steps.map((step) => step.id)), [steps]);
  const childCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const todo of todos) {
      if (!todo.parent_id || !stepIds.has(todo.parent_id) || todo.status === 'cancelled') continue;
      counts.set(todo.parent_id, (counts.get(todo.parent_id) ?? 0) + 1);
    }
    return counts;
  }, [stepIds, todos]);

  const { edges, allEdges, stepEdges, prerequisites } = useMemo(() => {
    const inner: FlowEdge[] = [];
    const every: FlowEdge[] = [];
    const own: typeof relationships = [];
    const before = new Map<string, string[]>();
    for (const relationship of relationships) {
      if (relationship.type !== 'depends_on') continue;
      const { source_task_id: source, target_task_id: target } = relationship;
      every.push({ before: target, after: source });
      if (!stepIds.has(source)) continue;
      own.push(relationship);
      before.set(source, [...(before.get(source) ?? []), target]);
      if (stepIds.has(target)) inner.push({ before: target, after: source });
    }
    return { edges: inner, allEdges: every, stepEdges: own, prerequisites: before };
  }, [relationships, stepIds]);
  const proposal = useFlowProposal(
    rootId,
    scopeId === rootId ? plan : null,
    steps.reduce((last, step) => Math.max(last, step.sort_order ?? 0), 0),
  );

  const toneOf = (step: TodoResponse): FlowTone => {
    if (step.status === 'completed' || step.status === 'cancelled') return 'done';
    const unfinished = (prerequisites.get(step.id) ?? []).filter(
      (id) => todoById.get(id)?.status !== 'completed',
    );
    if (unfinished.some((id) => !stepIds.has(id))) return 'blocked';
    if (unfinished.length > 0) return 'waiting';
    return step.status === 'in_progress' ? 'active' : 'ready';
  };

  const allNodes: FlowNode[] = steps.map((step) => {
    const tone = toneOf(step);
    const inside = childCount.get(step.id);
    const meta = [
      translateUi(TONE_LABELS[tone]),
      step.due_date && tone !== 'done' ? formatDueDate(step.due_date) : '',
      inside ? translateUi('{{count}} inside', { count: inside }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return { id: step.id, title: step.title, meta, tone, sortOrder: step.sort_order ?? 0 };
  });

  // Done steps at the start of the flow stay, dimmed; past three they fold
  // into one box. A done step only folds when everything before it is done.
  const doneLead = new Set<string>();
  const linked = new Set(edges.flatMap((edge) => [edge.before, edge.after]));
  for (let grew = true; grew;) {
    grew = false;
    for (const node of allNodes) {
      if (node.tone !== 'done' || doneLead.has(node.id) || !linked.has(node.id)) continue;
      const before = edges.filter((edge) => edge.after === node.id).map((edge) => edge.before);
      if (before.every((id) => doneLead.has(id))) {
        doneLead.add(node.id);
        grew = true;
      }
    }
  }
  const fold = !showDone && doneLead.size > DONE_FOLD_AFTER;
  const nodes: FlowNode[] = fold
    ? [
        {
          id: DONE_GROUP,
          title: translateUi('Done {{count}}', { count: doneLead.size }),
          tone: 'done',
          sortOrder: -1,
          fixed: true,
        },
        ...allNodes.filter((node) => !doneLead.has(node.id)),
      ]
    : allNodes;
  const shownEdges: FlowEdge[] = fold
    ? edges
        .filter((edge) => !doneLead.has(edge.after))
        .map((edge) => (doneLead.has(edge.before) ? { ...edge, before: DONE_GROUP } : edge))
    : edges;

  const canDoNow = allNodes.filter((node) => node.tone === 'ready' || node.tone === 'active');
  // The header the design gives a flow: how far it is, and how many times it forks.
  const counted = steps.filter((step) => step.status !== 'cancelled');
  const doneCount = counted.filter((step) => step.status === 'completed').length;
  // A fork into a cancelled step no longer exists, as Done x/y leaves it out.
  const cancelled = new Set(
    steps.filter((step) => step.status === 'cancelled').map((step) => step.id),
  );
  const branches = flowBranchCount(
    edges.filter((edge) => !cancelled.has(edge.before) && !cancelled.has(edge.after)),
  );
  const focusId = allNodes.find((node) => node.tone === 'active')?.id ?? canDoNow[0]?.id ?? null;
  const ends = steps.filter(
    (step) => linked.has(step.id) && !edges.some((edge) => edge.before === step.id),
  );
  const selectedEnd =
    selectedId && ends.length > 1 && ends.some((step) => step.id === selectedId)
      ? selectedId
      : null;

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
    // With several branch ends, Enter continues the selected one.
    if (!branch && selectedEnd) anchor.current = selectedEnd;
    const parentId = scopeId;
    setDraft('');
    queue.current = queue.current
      .catch(() => undefined)
      .then(async () => {
        const afterId = branch ? null : anchor.current;
        const result = await addStep.mutateAsync({ parentId, title, branchFromId, afterId });
        anchor.current = afterId ? result.todo.id : null;
        if (afterId) select(result.todo.id);
      })
      .catch(() => undefined);
  };

  const move = (id: string, afterId: string) => {
    // The step leaves its place first, so only an outside chain can loop.
    const others = allEdges.filter(
      (edge) =>
        !(
          stepIds.has(edge.before) &&
          stepIds.has(edge.after) &&
          (edge.before === id || edge.after === id)
        ),
    );
    if (waitsOn(others, afterId, id)) {
      useToastStore.getState().addToast(
        'warning',
        translateUi('“{{earlier}}” would come before “{{later}}”', {
          earlier: todoById.get(afterId)?.title ?? '',
          later: todoById.get(id)?.title ?? '',
        }),
      );
      return;
    }
    moveStep.mutate({ parentId: scopeId, stepId: id, afterId });
  };

  const openOrDrill = (id: string) => {
    if (id === DONE_GROUP) setShowDone(true);
    else if (childCount.has(id)) {
      setScopeId(id);
      select(null);
    } else if (id === selectedId) {
      openTask(id);
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
          {translateUi('Done {{done}}/{{total}}', { done: doneCount, total: counted.length })}
          {branches > 0 && ` · ${translateUi('Branches {{count}}', { count: branches })}`}
          {selectedId && stepIds.has(selectedId) && !childCount.has(selectedId) && (
            <button type="button" onClick={() => openTask(selectedId)}>
              {translateUi('Open task')}
            </button>
          )}
        </p>
      )}
      {proposal?.bar}
      <FlowCanvas
        nodes={proposal ? [...nodes, ...proposal.nodes] : nodes}
        edges={proposal ? [...shownEdges, ...proposal.edges] : shownEdges}
        ariaLabel={translateUi('Steps')}
        selectedId={selectedId}
        focusId={focusId}
        tailAfterId={selectedEnd}
        onSelect={openOrDrill}
        onToggle={(id) => {
          const step = todoById.get(id);
          if (step) toggle.mutate({ id, currentStatus: step.status });
        }}
        onMove={move}
        onRename={proposal?.onRename}
        onDiscard={proposal?.onDiscard}
        lead={
          steps.length > 0 && (
            <FlowPrerequisites
              scopeId={scopeId}
              todos={todos}
              steps={steps}
              stepEdges={stepEdges}
              selectedId={selectedId}
            />
          )
        }
        tail={
          <input
            className="cc-flow__input"
            value={draft}
            placeholder={translateUi('Next step')}
            title={translateUi('Next step · Enter, branch · Tab')}
            aria-label={translateUi('Next step')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                submit(false);
              } else if (
                event.key === 'Tab' &&
                !event.shiftKey &&
                draft.trim() &&
                steps.length > 0
              ) {
                event.preventDefault();
                submit(true);
              } else if (event.key === 'Escape') {
                select(null);
              }
            }}
          />
        }
      />
    </section>
  );
}
