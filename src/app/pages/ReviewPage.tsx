import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import EmptyState from '../components/shared/EmptyState';
import { CheckCircleIcon, ClipboardIcon } from '../components/shared/Icons';
import { useDecideReview, useReviewsQuery } from '../hooks/queries';
import type { ReviewItemResponse, ReviewStatus } from '../types/api';

const FILTERS: Array<{ value: ReviewStatus; label: string }> = [
  { value: 'pending', label: 'Needs review' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function subjectLabel(item: ReviewItemResponse) {
  return item.subject_type.replaceAll('_', ' ');
}

export default function ReviewPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = (searchParams.get('status') as ReviewStatus | null) ?? 'pending';
  const projectId = searchParams.get('project_id');
  const { data: items = [], isLoading } = useReviewsQuery(filter, projectId);
  const decide = useDecideReview();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const decideItem = (
    item: ReviewItemResponse,
    decision: 'approved' | 'changes_requested' | 'rejected',
  ) => {
    decide.mutate({ reviewId: item.id, decision, note: notes[item.id]?.trim() || undefined });
  };

  return (
    <div className="cc-review-page">
      <header className="cc-page-header cc-review-page__header">
        <div>
          <h1>Review</h1>
          <p>One place to approve plans and project outputs before they change your work.</p>
        </div>
        {projectId && (
          <button
            className="cc-btn"
            type="button"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            Back to project
          </button>
        )}
      </header>

      <div className="cc-review-filters" aria-label="Review status filters">
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
            {option.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="cc-project-workspace__loading">Loading reviews…</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={filter === 'pending' ? <CheckCircleIcon size={28} /> : <ClipboardIcon size={28} />}
          message={
            filter === 'pending' ? 'Nothing needs your review.' : 'No reviews match this filter.'
          }
        />
      ) : (
        <div className="cc-review-list">
          {items.map((item) => (
            <article className="cc-review-card" key={item.id}>
              <div className="cc-review-card__topline">
                <span className={`cc-review-card__risk cc-review-card__risk--${item.risk_level}`}>
                  {item.risk_level} risk
                </span>
                <span>{subjectLabel(item)}</span>
                {item.project_title && <span>{item.project_title}</span>}
                <time dateTime={item.requested_at}>
                  {new Date(item.requested_at).toLocaleString()}
                </time>
              </div>
              <h2>{item.subject_title || item.summary}</h2>
              <p className="cc-review-card__summary">{item.summary}</p>
              {item.subject_description && (
                <pre className="cc-review-card__preview">{item.subject_description}</pre>
              )}
              {item.subject_href && (
                <button
                  className="cc-review-card__link"
                  type="button"
                  onClick={() => navigate(item.subject_href!)}
                >
                  Open full context
                </button>
              )}
              {(item.status === 'pending' || item.status === 'changes_requested') && (
                <div className="cc-review-card__decision">
                  <textarea
                    rows={2}
                    value={notes[item.id] ?? item.review_note ?? ''}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                    placeholder="Optional review note"
                    aria-label={`Review note for ${item.subject_title || item.summary}`}
                  />
                  <div className="cc-review-card__actions">
                    <button
                      className="cc-btn cc-btn--primary"
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => decideItem(item, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      className="cc-btn"
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => decideItem(item, 'changes_requested')}
                    >
                      Request changes
                    </button>
                    <button
                      className="cc-btn cc-btn--danger"
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => decideItem(item, 'rejected')}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
              {item.review_note && item.status !== 'pending' && (
                <p className="cc-review-card__note">Review note: {item.review_note}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
