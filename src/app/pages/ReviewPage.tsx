import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AgentRunReviewHandoff from '../components/review/AgentRunReviewHandoff';
import ReviewItemCard, { approvalImpact } from '../components/review/ReviewItemCard';
import EmptyState from '../components/shared/EmptyState';
import { CheckCircleIcon, ClipboardIcon } from '../components/shared/Icons';
import { useDecideReview, useReviewsQuery } from '../hooks/queries';
import type { AgentRunReviewOutcome, ReviewItemResponse, ReviewStatus } from '../types/api';
import { translateUi } from '../i18n';
const FILTERS: Array<{
  value: ReviewStatus;
  label: string;
}> = [
  { value: 'pending', label: 'Needs review' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
interface ApprovedAgentRunHandoff {
  reviewId: string;
  taskTitle: string | null;
  outcome: AgentRunReviewOutcome;
}
export default function ReviewPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = (searchParams.get('status') as ReviewStatus | null) ?? 'pending';
  const projectId = searchParams.get('project_id');
  const { data: items = [], isLoading } = useReviewsQuery(filter, projectId);
  const decide = useDecideReview();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [approvedAgentRun, setApprovedAgentRun] = useState<ApprovedAgentRunHandoff | null>(null);
  const visibleItems =
    approvedAgentRun && (filter === 'pending' || filter === 'changes_requested')
      ? items.filter((item) => item.id !== approvedAgentRun.reviewId)
      : items;
  const decideItem = (
    item: ReviewItemResponse,
    decision: 'approved' | 'changes_requested' | 'rejected',
  ) => {
    decide.mutate(
      { reviewId: item.id, decision, note: notes[item.id]?.trim() || undefined },
      {
        onSuccess: (result) => {
          if (decision !== 'approved' || item.subject_type !== 'agent_run') return;
          const impact = approvalImpact(item);
          setApprovedAgentRun({
            reviewId: item.id,
            taskTitle: item.subject_title,
            outcome: {
              ...(result.agentRunOutcome ?? {}),
              todo_id: result.agentRunOutcome?.todo_id ?? impact?.todo_id,
              graph_revision: result.agentRunOutcome?.graph_revision ?? impact?.graph_revision,
            },
          });
        },
      },
    );
  };
  return (
    <div className="cc-review-page">
      <header className="cc-page-header cc-review-page__header">
        <div>
          <h1>{translateUi('Review')}</h1>
          <p>
            {translateUi(
              'One place to approve plans and project outputs before they change your work.',
            )}
          </p>
        </div>
        {projectId && (
          <button
            className="cc-btn"
            type="button"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            {translateUi('\n            Back to project\n          ')}
          </button>
        )}
      </header>

      {approvedAgentRun && (
        <AgentRunReviewHandoff
          taskTitle={approvedAgentRun.taskTitle}
          outcome={approvedAgentRun.outcome}
          onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
          onOpenInbox={() => navigate('/inbox')}
        />
      )}

      <div className="cc-review-filters" aria-label={translateUi('Review status filters')}>
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`cc-review-filter${filter === option.value ? ' cc-review-filter--active' : ''}`}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set('status', option.value);
              setSearchParams(next);
            }}
          >
            {translateUi(option.label)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="cc-project-workspace__loading">{translateUi('Loading reviews…')}</div>
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={filter === 'pending' ? <CheckCircleIcon size={28} /> : <ClipboardIcon size={28} />}
          message={
            filter === 'pending'
              ? translateUi('Nothing needs your review.')
              : translateUi('No reviews match this filter.')
          }
        />
      ) : (
        <div className="cc-review-list">
          {visibleItems.map((item) => (
            <ReviewItemCard
              key={item.id}
              item={item}
              note={notes[item.id] ?? item.review_note ?? ''}
              onNoteChange={(note) => setNotes((current) => ({ ...current, [item.id]: note }))}
              onDecide={(decision) => decideItem(item, decision)}
              isDeciding={decide.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
