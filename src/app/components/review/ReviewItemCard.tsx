import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AgentRunReviewHandoff from './AgentRunReviewHandoff';
import type { ReviewItemResponse } from '../../types/api';
import { agentRunApprovalImpact, type ReviewDecision } from '../../utils/agentRunReview';
import { translateUi } from '../../i18n';
import { formatShortDateTime } from '../../utils/formatters';

function riskLabel(level: string): string {
  if (level === 'low') return translateUi('Low risk');
  if (level === 'high') return translateUi('High risk');
  return translateUi('Worth a close look');
}

export function subjectLabel(item: ReviewItemResponse): string {
  const labels: Record<string, string> = {
    plan_proposal: translateUi('AI suggestion'),
    artifact_revision: translateUi('Document change'),
    agent_run: translateUi('Agent result'),
    data_source_write: translateUi('Change to a shared file'),
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
  // The note says what to change, so it opens only once changes are asked for.
  const [requesting, setRequesting] = useState(false);
  const title = item.subject_title || item.summary;
  const summary =
    item.summary && item.summary !== title
      ? item.summary
      : item.subject_type === 'plan_proposal'
        ? translateUi('Check the steps the AI suggested before adding them.')
        : null;
  return (
    <article className="cc-review-card">
      <div className="cc-review-card__topline">
        <span className={`cc-review-card__risk cc-review-card__risk--${item.risk_level}`}>
          {riskLabel(item.risk_level)}
        </span>
        <span>{subjectLabel(item)}</span>
        {item.project_title && <span>{item.project_title}</span>}
        <time dateTime={item.requested_at}>{formatShortDateTime(item.requested_at)}</time>
      </div>
      <h2>{title}</h2>
      {summary && <p className="cc-review-card__summary">{summary}</p>}
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
          {requesting && (
            <textarea
              rows={2}
              autoFocus
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder={translateUi('What should change?')}
              aria-label={translateUi('Review note for {{title}}', { title })}
            />
          )}
          <div className="cc-review-card__actions">
            {requesting ? (
              <>
                <button
                  className="cc-btn cc-btn--primary"
                  type="button"
                  disabled={isDeciding || !note.trim()}
                  onClick={() => onDecide('changes_requested')}
                >
                  {translateUi('Request changes')}
                </button>
                <button
                  className="cc-btn cc-btn--ghost"
                  type="button"
                  onClick={() => setRequesting(false)}
                >
                  {translateUi('Cancel')}
                </button>
              </>
            ) : (
              <>
                <button
                  className="cc-btn cc-btn--primary"
                  type="button"
                  disabled={isDeciding}
                  onClick={() => onDecide('approved')}
                >
                  {translateUi('Approve')}
                </button>
                {/* A change to a file is approved or rejected as it stands. */}
                {item.status === 'pending' && item.subject_type !== 'data_source_write' && (
                  <button
                    className="cc-btn"
                    type="button"
                    disabled={isDeciding}
                    onClick={() => setRequesting(true)}
                  >
                    {translateUi('Request changes')}
                  </button>
                )}
                <button
                  className="cc-btn cc-btn--danger"
                  type="button"
                  disabled={isDeciding}
                  onClick={() => onDecide('rejected')}
                >
                  {translateUi('Reject')}
                </button>
              </>
            )}
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
