import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AgentRunReviewHandoff from './AgentRunReviewHandoff';
import { useUpdateScheduledJob } from '../../hooks/queries';
import type { ReviewItemResponse } from '../../types/api';
import { agentRunApprovalImpact, type ReviewDecision } from '../../utils/agentRunReview';
import { translateUi } from '../../i18n';
import { formatShortDateTime } from '../../utils/formatters';

/**
 * The server's risk level in words. "Read-only tools" is not a degree of
 * risk but what the run did: nothing it could have changed, yet it looked
 * things up (web search, a read-only server), so it is named apart from low.
 */
export function riskLabel(level: string): string {
  if (level === 'low') return translateUi('Low risk');
  if (level === 'read_only_tools') return translateUi('Read-only tools');
  if (level === 'high') return translateUi('High risk');
  return translateUi('Worth a close look');
}

export interface ReviewAutomation {
  scheduled_job_id: string;
  title: string;
  auto_approve_low_risk: boolean;
  /**
   * Whether the card may show "Don't ask next time": the server says yes
   * only for a low-risk result, and only once two results in a row were
   * approved untouched (or the job already skips review, so it can be undone).
   */
  offer_skip_review: boolean;
  /** This result was adopted without asking; Today lists those. */
  auto_approved: boolean;
}

/** The automation that produced this result, when one did. */
export function reviewAutomation(item: ReviewItemResponse): ReviewAutomation | null {
  const raw = item.metadata.automation as Partial<ReviewAutomation> | undefined;
  if (!raw || typeof raw.scheduled_job_id !== 'string') return null;
  return {
    scheduled_job_id: raw.scheduled_job_id,
    title: typeof raw.title === 'string' ? raw.title : '',
    auto_approve_low_risk: raw.auto_approve_low_risk === true,
    offer_skip_review: raw.offer_skip_review === true,
    auto_approved: raw.auto_approved === true,
  };
}

export interface ChangedFile {
  path: string;
  status: string;
}

/**
 * The files a run changed, when its executor recorded them (OpenCode diffs
 * its workspace); null when nobody knows, which is not the same as none.
 */
export function reviewChangedFiles(
  item: ReviewItemResponse,
): { files: ChangedFile[]; count: number } | null {
  const raw = item.metadata.changed_files;
  if (!Array.isArray(raw)) return null;
  const files = raw
    .filter((file): file is ChangedFile => typeof file?.path === 'string')
    .map((file) => ({ path: file.path, status: String(file.status ?? 'modified') }));
  const count =
    typeof item.metadata.changed_files_count === 'number'
      ? item.metadata.changed_files_count
      : files.length;
  return { files, count };
}

/** "+" for a new file, "−" for a removed one, "~" for one that changed. */
function changeMark(status: string): { mark: string; tone: string } {
  if (status === 'added') return { mark: '+', tone: 'added' };
  if (status === 'deleted' || status === 'removed') return { mark: '−', tone: 'deleted' };
  return { mark: '~', tone: 'modified' };
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
  const updateJob = useUpdateScheduledJob();
  const impact = agentRunApprovalImpact(item);
  const automation = reviewAutomation(item);
  const changed = reviewChangedFiles(item);
  const open = item.status === 'pending' || item.status === 'changes_requested';
  // "Don't ask next time" lives on the card, not in a settings screen: the
  // automation is switched right where its result is being looked at. The
  // server decides when the box is offered, so it is never shown before a
  // result has been read, nor for a result that could have changed files.
  const setSkipsReview = (checked: boolean) =>
    updateJob.mutate({
      id: automation!.scheduled_job_id,
      changes: { auto_approve_low_risk: checked },
    });
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
        {changed && changed.count > 0 && (
          <span>{translateUi('{{count}} files changed', { count: changed.count })}</span>
        )}
        <span>{subjectLabel(item)}</span>
        {automation && (
          <span>{translateUi('Automation · {{title}}', { title: automation.title })}</span>
        )}
        {item.project_title && <span>{item.project_title}</span>}
        <time dateTime={item.requested_at}>{formatShortDateTime(item.requested_at)}</time>
      </div>
      <h2>{title}</h2>
      {summary && <p className="cc-review-card__summary">{summary}</p>}
      {changed && changed.files.length > 0 && (
        <ul className="cc-review-card__files" aria-label={translateUi('Changed files')}>
          {changed.files.map((file) => {
            const { mark, tone } = changeMark(file.status);
            return (
              <li key={file.path}>
                <span className={`cc-review-card__file-mark cc-review-card__file-mark--${tone}`}>
                  {mark}
                </span>
                <span className="cc-review-card__file-path">{file.path}</span>
              </li>
            );
          })}
          {changed.count > changed.files.length && (
            <li className="cc-review-card__files-more">
              {translateUi('{{count}} more', { count: changed.count - changed.files.length })}
            </li>
          )}
        </ul>
      )}
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
      {automation?.offer_skip_review && (
        <div className="cc-review-card__automation">
          <label>
            <input
              type="checkbox"
              checked={automation.auto_approve_low_risk}
              disabled={updateJob.isPending}
              onChange={(event) => setSkipsReview(event.target.checked)}
            />
            {translateUi("Don't ask next time")}
          </label>
          <span>
            {translateUi(
              'Low-risk results of this automation are approved as they land. A result that could have changed files still asks.',
            )}
          </span>
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
