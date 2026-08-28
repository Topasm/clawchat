import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AgentRunReviewHandoff from '../components/review/AgentRunReviewHandoff';
import EmptyState from '../components/shared/EmptyState';
import { CheckCircleIcon, ClipboardIcon } from '../components/shared/Icons';
import { useDecideReview, useReviewsQuery } from '../hooks/queries';
import type { AgentRunReviewOutcome, ReviewItemResponse, ReviewStatus } from '../types/api';
import { AgentRunApprovalImpactSchema } from '../types/schemas';

const FILTERS: Array<{ value: ReviewStatus; label: string }> = [
  { value: 'pending', label: 'Needs review' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function subjectLabel(item: ReviewItemResponse) {
  return item.subject_type.replaceAll('_', ' ');
}

function approvalImpact(item: ReviewItemResponse) {
  if (item.subject_type !== 'agent_run') return null;
  const parsed = AgentRunApprovalImpactSchema.safeParse(item.metadata.approval_impact);
  return parsed.success ? parsed.data : null;
}

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

      {approvedAgentRun && (
        <AgentRunReviewHandoff
          taskTitle={approvedAgentRun.taskTitle}
          outcome={approvedAgentRun.outcome}
          onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
          onOpenInbox={() => navigate('/inbox')}
        />
      )}

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
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={filter === 'pending' ? <CheckCircleIcon size={28} /> : <ClipboardIcon size={28} />}
          message={
            filter === 'pending' ? 'Nothing needs your review.' : 'No reviews match this filter.'
          }
        />
      ) : (
        <div className="cc-review-list">
          {visibleItems.map((item) => {
            const impact = approvalImpact(item);
            return (
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
                {(item.status === 'pending' || item.status === 'changes_requested') && impact && (
                  <AgentRunReviewHandoff
                    taskTitle={item.subject_title}
                    impact={impact}
                    onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
                    onOpenInbox={() => navigate('/inbox')}
                  />
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
                      {item.status === 'pending' && (
                        <button
                          className="cc-btn"
                          type="button"
                          disabled={decide.isPending}
                          onClick={() => decideItem(item, 'changes_requested')}
                        >
                          Request changes
                        </button>
                      )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
