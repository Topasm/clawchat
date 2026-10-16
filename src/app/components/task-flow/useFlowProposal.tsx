import { useState, type ReactNode } from 'react';
import {
  getPlanProposalMutationError,
  isStalePlanProposalError,
  useApplyPlanProposal,
  useDismissPlanProposal,
  useGeneratePlanProposal,
} from '../../hooks/queries';
import { useToastStore } from '../../stores/useToastStore';
import type { PlanProposalResponse, PlanSubtask } from '../../types/api';
import {
  buildProposalEdges,
  proposalIndexFromNodeId,
  proposalNodeId,
  toggleProposalSelection,
} from '../task-graph/taskGraphProposal';
import { translateUi } from '../../i18n';
import type { FlowEdge, FlowNode } from './FlowCanvas';

interface Draft {
  proposalId: string;
  subtasks: PlanSubtask[];
  selected: Set<number>;
}

function fresh(plan: PlanProposalResponse): Draft {
  return {
    proposalId: plan.proposal_id,
    subtasks: plan.subtasks,
    selected: new Set(plan.subtasks.map((_, index) => index)),
  };
}

export interface FlowProposal {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onRename: (id: string, title: string) => void;
  onDiscard: (id: string) => void;
  /** The proposal's summary, problems and its Add all / Dismiss buttons. */
  bar: ReactNode;
}

/**
 * An AI plan drawn into the flow it would change: each proposed step is a
 * dashed box after the existing ones, titled in place and left out with ×.
 * Leaving one out also leaves out what waits on it, so what is added runs.
 */
export default function useFlowProposal(
  todoId: string,
  plan: PlanProposalResponse | null | undefined,
  afterOrder: number,
): FlowProposal | null {
  const applyPlan = useApplyPlanProposal();
  const dismissPlan = useDismissPlanProposal();
  const generatePlan = useGeneratePlanProposal();
  const [state, setState] = useState<Draft | null>(null);

  if (!plan || (plan.status !== 'draft' && plan.status !== 'stale')) return null;
  const draft = state?.proposalId === plan.proposal_id ? state : fresh(plan);
  const { subtasks, selected } = draft;

  const nodes: FlowNode[] = subtasks.map((subtask, index) => ({
    id: proposalNodeId(index),
    title: subtask.title,
    meta: subtask.estimated_minutes ? `${subtask.estimated_minutes}m` : undefined,
    tone: selected.has(index) ? 'proposed' : 'excluded',
    sortOrder: afterOrder + 1 + index,
  }));

  const onRename = (id: string, title: string) => {
    const index = proposalIndexFromNodeId(id);
    if (index === null) return;
    setState({
      ...draft,
      subtasks: subtasks.map((subtask, at) => (at === index ? { ...subtask, title } : subtask)),
    });
  };
  const onDiscard = (id: string) => {
    const index = proposalIndexFromNodeId(id);
    if (index === null) return;
    setState({ ...draft, selected: toggleProposalSelection(subtasks, selected, index) });
  };

  const stale = plan.status === 'stale' || isStalePlanProposalError(applyPlan.error);
  const legacy = plan.base_graph_revision === null;
  const busy = applyPlan.isPending || dismissPlan.isPending || generatePlan.isPending;
  const canApply =
    plan.status === 'draft' &&
    !stale &&
    !legacy &&
    plan.validation.errors.length === 0 &&
    selected.size > 0 &&
    subtasks.every((subtask, index) => !selected.has(index) || subtask.title.trim());

  const apply = async () => {
    if (plan.base_graph_revision === null) return;
    try {
      await applyPlan.mutateAsync({
        todoId,
        proposalId: plan.proposal_id,
        baseGraphRevision: plan.base_graph_revision,
        selectedIndices: [...selected].sort((left, right) => left - right),
        // A step left out may have lost its title; send it back as proposed.
        subtasks: subtasks.map((subtask, index) =>
          subtask.title.trim() ? subtask : plan.subtasks[index],
        ),
      });
    } catch {
      // The mutation reports the error; a stale proposal stays to regenerate.
    }
  };
  const dismiss = async () => {
    try {
      await dismissPlan.mutateAsync({ todoId, proposalId: plan.proposal_id });
      useToastStore.getState().addToast('info', translateUi('Plan dismissed'));
    } catch {
      // The mutation reports the error.
    }
  };
  const regenerate = async () => {
    try {
      await generatePlan.mutateAsync({ todoId });
      applyPlan.reset();
    } catch {
      // The mutation reports the error.
    }
  };

  const applyError = applyPlan.error ? getPlanProposalMutationError(applyPlan.error) : null;
  const bar = (
    <div className="cc-flow__proposal" aria-label={translateUi('Proposed tasks')}>
      <span className="cc-flow__proposal-summary">
        {plan.summary || translateUi('Proposed tasks')}
      </span>
      {plan.validation.errors.map((issue, index) => (
        <span key={`error-${index}`} role="alert">
          {translateUi('Cannot apply:')} {issue.message}
        </span>
      ))}
      {plan.validation.warnings.map((issue, index) => (
        <span key={`warning-${index}`}>
          {translateUi('Review:')} {issue.message}
        </span>
      ))}
      {(stale || legacy) && (
        <span role="alert">
          {translateUi('The task graph changed after this proposal was created.')}
        </span>
      )}
      {applyError && !stale && <span role="alert">{applyError.message}</span>}
      <span className="cc-flow__proposal-actions">
        {stale || legacy ? (
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={busy}
            onClick={() => void regenerate()}
          >
            {generatePlan.isPending ? translateUi('Regenerating…') : translateUi('Regenerate')}
          </button>
        ) : (
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={!canApply || busy}
            onClick={() => void apply()}
          >
            {applyPlan.isPending
              ? translateUi('Applying…')
              : selected.size === subtasks.length
                ? translateUi('Add all')
                : translateUi('Add {{count}}', { count: selected.size })}
          </button>
        )}
        <button
          type="button"
          className="cc-btn cc-btn--ghost"
          disabled={busy}
          onClick={() => void dismiss()}
        >
          {translateUi('Dismiss')}
        </button>
      </span>
    </div>
  );

  return { nodes, edges: buildProposalEdges(subtasks), onRename, onDiscard, bar };
}
