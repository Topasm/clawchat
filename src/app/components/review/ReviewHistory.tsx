import { useState } from 'react';
import ReviewItemCard from './ReviewItemCard';
import EmptyState from '../shared/EmptyState';
import { CheckCircleIcon, ClipboardIcon } from '../shared/Icons';
import { useReviewsQuery } from '../../hooks/queries';
import type { ReviewItemResponse, ReviewStatus } from '../../types/api';
import type { ReviewDecision } from '../../utils/agentRunReview';
import { translateUi } from '../../i18n';
const FILTERS: Array<{ value: ReviewStatus; label: string }> = [
  { value: 'pending', label: 'Needs review' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
interface ReviewHistoryProps {
  status: ReviewStatus;
  onStatusChange: (status: ReviewStatus) => void;
  projectId: string | null;
  /** A review just approved on this page; it leaves the open filters once its handoff shows. */
  hiddenReviewId?: string | null;
  onDecide: (item: ReviewItemResponse, decision: ReviewDecision, note?: string) => void;
  isDeciding: boolean;
}
/** Every review by status, decided in place where it is still open. */
export default function ReviewHistory({
  status,
  onStatusChange,
  projectId,
  hiddenReviewId,
  onDecide,
  isDeciding,
}: ReviewHistoryProps) {
  const { data: items = [], isLoading } = useReviewsQuery(status, projectId);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const visibleItems =
    hiddenReviewId && (status === 'pending' || status === 'changes_requested')
      ? items.filter((item) => item.id !== hiddenReviewId)
      : items;
  return (
    <>
      <div className="cc-review-filters" aria-label={translateUi('Review status filters')}>
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`cc-review-filter${status === option.value ? ' cc-review-filter--active' : ''}`}
            onClick={() => onStatusChange(option.value)}
          >
            {translateUi(option.label)}
          </button>
        ))}
      </div>
      {status === 'changes_requested' && (
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
          icon={status === 'pending' ? <CheckCircleIcon size={28} /> : <ClipboardIcon size={28} />}
          message={
            status === 'pending'
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
              onDecide={(decision) => onDecide(item, decision, notes[item.id])}
              isDeciding={isDeciding}
            />
          ))}
        </div>
      )}
    </>
  );
}
