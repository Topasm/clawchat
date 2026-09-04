import { useNavigate } from 'react-router-dom';
import AgentRunReviewHandoff from './AgentRunReviewHandoff';
import type { ReviewItemResponse } from '../../types/api';
import { agentRunApprovalImpact, type ReviewDecision } from '../../utils/agentRunReview';
import { translateUi } from '../../i18n';

export function subjectLabel(item: ReviewItemResponse): string {
  const labels: Record<string, string> = {
    plan_proposal: translateUi('Plan proposal'),
    artifact_revision: translateUi('Artifact revision'),
    agent_run: translateUi('Agent run'),
  };
  return labels[item.subject_type] ?? item.subject_type.replaceAll('_', ' ');
}

interface ReviewItemCardProps {
  item: ReviewItemResponse;
  note: string;
  onNoteChange: (note: string) => void;
  onDecide: (decision: ReviewDecision) => void;
  isDeciding: boolean;
}

/**
 * One item in the human review queue, wherever that queue is shown.
 *
 * Decisions are the caller's. The card only reports intent; the shared
 * review-decision hook owns mutation and any post-approval handoff.
 */
export default function ReviewItemCard({
  item,
  note,
  onNoteChange,
  onDecide,
  isDeciding,
}: ReviewItemCardProps) {
  const navigate = useNavigate();
  const impact = agentRunApprovalImpact(item);
  const open = item.status === 'pending' || item.status === 'changes_requested';
  return (
    <article className="cc-review-card">
      <div className="cc-review-card__topline">
        <span className={`cc-review-card__risk cc-review-card__risk--${item.risk_level}`}>
          {item.risk_level}
          {translateUi(' risk\n                  ')}
        </span>
        <span>{subjectLabel(item)}</span>
        {item.project_title && <span>{item.project_title}</span>}
        <time dateTime={item.requested_at}>{new Date(item.requested_at).toLocaleString()}</time>
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
          {translateUi('\n                    Open full context\n                  ')}
        </button>
      )}
      {open && impact && (
        <AgentRunReviewHandoff
          taskTitle={item.subject_title}
          impact={impact}
          onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
        />
      )}
      {open && (
        <div className="cc-review-card__decision">
          <textarea
            rows={2}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder={translateUi('Optional review note')}
            aria-label={translateUi('Review note for {{title}}', {
              title: item.subject_title || item.summary,
            })}
          />
          <div className="cc-review-card__actions">
            <button
              className="cc-btn cc-btn--primary"
              type="button"
              disabled={isDeciding}
              onClick={() => onDecide('approved')}
            >
              {translateUi('\n                        Approve\n                      ')}
            </button>
            {item.status === 'pending' && (
              <button
                className="cc-btn"
                type="button"
                disabled={isDeciding}
                onClick={() => onDecide('changes_requested')}
              >
                {translateUi(
                  '\n                          Request changes\n                        ',
                )}
              </button>
            )}
            <button
              className="cc-btn cc-btn--danger"
              type="button"
              disabled={isDeciding}
              onClick={() => onDecide('rejected')}
            >
              {translateUi('\n                        Reject\n                      ')}
            </button>
          </div>
        </div>
      )}
      {item.review_note && item.status !== 'pending' && (
        <p className="cc-review-card__note">
          {translateUi('Review note: ')}
          {item.review_note}
        </p>
      )}
    </article>
  );
}
