import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useApplyPlanProposal,
  useDismissPlanProposal,
  useGeneratePlanProposal,
  useLatestPlanProposalQuery,
  usePlanProposalQuery,
} from '../../hooks/queries';
import { useToastStore } from '../../stores/useToastStore';
import type { PlanProposalResponse } from '../../types/api';
import { translateUi } from '../../i18n';
import PlanReviewDiff from '../shared/PlanReviewDiff';
import { CheckIcon, WarningIcon } from '../shared/Icons';

const MAX_POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 1500;

function belongsToRequest(plan: PlanProposalResponse, requestedAt: string): boolean {
  const proposalTimestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(plan.created_at)
    ? plan.created_at
    : `${plan.created_at}Z`;
  const proposalTime = Date.parse(proposalTimestamp);
  const requestTime = Date.parse(requestedAt);
  return (
    Number.isFinite(proposalTime) && Number.isFinite(requestTime) && proposalTime >= requestTime
  );
}

export default function ChatPlanProposalCard({ metadata }: { metadata: Record<string, unknown> }) {
  const navigate = useNavigate();
  const todoId = typeof metadata.todo_id === 'string' ? metadata.todo_id : '';
  const todoTitle = typeof metadata.todo_title === 'string' ? metadata.todo_title : '';
  const requestedAt =
    typeof metadata.plan_requested_at === 'string' ? metadata.plan_requested_at : '';
  const proposalId = typeof metadata.plan_proposal_id === 'string' ? metadata.plan_proposal_id : '';
  const isDirectGraphChange = metadata.proposal_kind === 'add_task';
  const exactPlanQuery = usePlanProposalQuery(todoId, proposalId, Boolean(todoId && proposalId));
  const latestPlanQuery = useLatestPlanProposalQuery(
    todoId,
    Boolean(todoId && requestedAt && !proposalId),
  );
  const applyPlan = useApplyPlanProposal();
  const dismissPlan = useDismissPlanProposal();
  const generatePlan = useGeneratePlanProposal();
  const addToast = useToastStore((state) => state.addToast);
  const [pollAttempts, setPollAttempts] = useState(0);
  const plan = proposalId
    ? (exactPlanQuery.data ?? null)
    : latestPlanQuery.data && belongsToRequest(latestPlanQuery.data, requestedAt)
      ? latestPlanQuery.data
      : null;
  const shouldPoll =
    Boolean(todoId && (proposalId || requestedAt)) &&
    pollAttempts < MAX_POLL_ATTEMPTS &&
    (!plan || plan.status === 'generating');
  const refetchPlan = proposalId ? exactPlanQuery.refetch : latestPlanQuery.refetch;

  useEffect(() => {
    setPollAttempts(0);
  }, [proposalId, requestedAt, todoId]);

  useEffect(() => {
    if (!shouldPoll) return;
    const timeoutId = window.setTimeout(() => {
      void refetchPlan().finally(() => setPollAttempts((count) => count + 1));
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timeoutId);
  }, [refetchPlan, shouldPoll]);

  const handleApply = async (selectedIndices: number[]) => {
    if (!plan || plan.base_graph_revision === null) return;
    await applyPlan.mutateAsync({
      todoId,
      proposalId: plan.proposal_id,
      baseGraphRevision: plan.base_graph_revision,
      selectedIndices,
      subtasks: plan.subtasks,
    });
  };
  const handleDismiss = async () => {
    if (!plan) return;
    await dismissPlan.mutateAsync({ todoId, proposalId: plan.proposal_id });
    addToast('info', translateUi('Plan dismissed'));
  };
  const handleRegenerate = async () => {
    await generatePlan.mutateAsync({ todoId });
    applyPlan.reset();
  };
  const isReviewable = plan?.status === 'draft' || plan?.status === 'stale';
  const statusCopy =
    !proposalId && !requestedAt
      ? translateUi('Open the task to review this plan.')
      : plan?.status === 'applied'
        ? translateUi('Plan applied')
        : plan?.status === 'rejected'
          ? translateUi('Plan dismissed')
          : plan?.status === 'reverted'
            ? translateUi('Plan changes undone')
            : plan?.status === 'failed'
              ? translateUi('Plan generation failed')
              : plan?.status === 'applying'
                ? translateUi('Applying…')
                : translateUi('Preparing a graph change proposal…');

  return (
    <div className="cc-action-card cc-action-card--plan">
      <div
        className={`cc-action-card__icon ${plan?.status === 'failed' ? 'cc-action-card__icon--warning' : 'cc-action-card__icon--todo'}`}
      >
        {plan?.status === 'failed' ? <WarningIcon size={14} /> : <CheckIcon size={14} />}
      </div>
      <div className="cc-action-card__content">
        <div className="cc-action-card__plan-heading">
          <div>
            <span className="cc-action-card__label">{translateUi('Graph change proposal')}</span>
            <span className="cc-action-card__title">{todoTitle}</span>
          </div>
          <button
            type="button"
            className="cc-btn cc-btn--ghost cc-action-card__view-btn"
            onClick={() => navigate(`/tasks/${todoId}`)}
          >
            {translateUi('Open task')}
          </button>
        </div>

        {isReviewable && plan ? (
          <PlanReviewDiff
            compact
            plan={plan}
            onApply={handleApply}
            onDismiss={handleDismiss}
            onRegenerate={handleRegenerate}
            applyError={applyPlan.error}
            isApplying={applyPlan.isPending}
            isDismissing={dismissPlan.isPending}
            isRegenerating={generatePlan.isPending}
            allowRegenerate={!isDirectGraphChange}
          />
        ) : (
          <div className="cc-action-card__plan-status">
            <span className="cc-action-card__detail" role="status">
              {statusCopy}
            </span>
            {plan?.status === 'failed' && (
              <button
                type="button"
                className="cc-btn cc-btn--ghost"
                disabled={generatePlan.isPending}
                onClick={() => void handleRegenerate().catch(() => undefined)}
              >
                {generatePlan.isPending ? translateUi('Regenerating…') : translateUi('Regenerate')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
