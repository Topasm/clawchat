import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AgentRunReviewOutcomeHandoff from '../components/review/AgentRunReviewOutcomeHandoff';
import ReviewItemCard from '../components/review/ReviewItemCard';
import EmptyState from '../components/shared/EmptyState';
import { CheckCircleIcon, ClipboardIcon } from '../components/shared/Icons';
import { useReviewsQuery } from '../hooks/queries';
import useReviewDecisionHandoff from '../hooks/useReviewDecisionHandoff';
import type { ReviewStatus } from '../types/api';
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
export default function ReviewPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = (searchParams.get('status') as ReviewStatus | null) ?? 'pending';
  const projectId = searchParams.get('project_id');
  const { data: items = [], isLoading } = useReviewsQuery(filter, projectId);
  const { approvedAgentRun, decide, decideItem, dismissApprovedAgentRun } =
    useReviewDecisionHandoff();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const visibleItems =
    approvedAgentRun && (filter === 'pending' || filter === 'changes_requested')
      ? items.filter((item) => item.id !== approvedAgentRun.reviewId)
      : items;
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
        <AgentRunReviewOutcomeHandoff
          projectId={approvedAgentRun.projectId}
          taskTitle={approvedAgentRun.taskTitle}
          outcome={approvedAgentRun.outcome}
          onDismiss={dismissApprovedAgentRun}
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

      {filter === 'changes_requested' && (
        <p className="cc-review-page__filter-note">
          {translateUi(
            'Items with a note resume automatically and move back to the run thread, so they no longer remain in this filter.',
          )}
        </p>
      )}

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
              onDecide={(decision) => decideItem(item, decision, notes[item.id])}
              isDeciding={decide.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
