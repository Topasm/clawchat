import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useResumeAgentRun,
  useResolvePaseoPermission,
  useReviewsQuery,
  useRunsAwaitingInputQuery,
} from '../../hooks/queries';
import useReviewDecisionHandoff from '../../hooks/useReviewDecisionHandoff';
import { translateUi } from '../../i18n';
import AgentRunReviewOutcomeHandoff from '../review/AgentRunReviewOutcomeHandoff';

/**
 * A persisted moment in an agent run's life, written into its thread by the
 * server: a question, a result to review, an approval, a failure.
 *
 * The message is a snapshot; the actions are live. While the run is still
 * waiting on the user the card takes the answer or the decision right here,
 * and once it has moved on the card keeps the record and offers the link.
 */
interface RunStatusCardProps {
  metadata: Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
export function runStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'waiting_review':
      return translateUi('Waiting for review');
    case 'waiting_input':
      return translateUi('Needs your input');
    case 'completed':
      return translateUi('Complete');
    case 'cancelled':
      return translateUi('Cancelled');
    case 'failed':
      return translateUi('Failed');
    default:
      return translateUi('Running');
  }
}
export default function RunStatusCard({ metadata }: RunStatusCardProps) {
  const navigate = useNavigate();
  const status = text(metadata.status);
  const runId = text(metadata.run_id);
  const error = text(metadata.error);
  const hostLabel = text(metadata.host_label);
  const needsReview = status === 'waiting_review';
  const needsInput = status === 'waiting_input';
  const isFailed = status === 'failed';
  const needsUser = needsReview || needsInput;
  const { data: awaitingInput = [] } = useRunsAwaitingInputQuery();
  const { data: pendingReviews = [] } = useReviewsQuery();
  const stillWaitingForInput =
    needsInput && Boolean(runId) && awaitingInput.some((run) => run.id === runId);
  const pendingReview = needsReview
    ? pendingReviews.find(
        (item) => item.subject_type === 'agent_run' && item.metadata?.run_id === runId,
      )
    : undefined;
  const resume = useResumeAgentRun();
  const resolvePermission = useResolvePaseoPermission();
  const {
    approvedAgentRun: approvedRun,
    decide,
    decideItem,
    dismissApprovedAgentRun,
  } = useReviewDecisionHandoff();
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState('');
  const inputOptions = Array.isArray(metadata.input_options)
    ? metadata.input_options.filter((option): option is string => typeof option === 'string')
    : [];
  const permissions = Array.isArray(metadata.permissions) ? metadata.permissions : [];
  const settledLabel = needsInput
    ? translateUi('Already answered')
    : needsReview
      ? translateUi('Already reviewed')
      : null;
  const live = stillWaitingForInput || Boolean(pendingReview && !approvedRun);
  return (
    <div
      className={`cc-task-progress cc-run-status-card${live ? ' cc-task-progress--attention' : ''}`}
      data-run-status={status}
    >
      <div className="cc-task-progress__header">
        <span className="cc-task-progress__label">
          {translateUi('Agent run')}
          {hostLabel ? ` · ${translateUi('on {{host}}', { host: hostLabel })}` : ''}
        </span>
        <span className="cc-task-progress__percent">
          {needsUser && !live && settledLabel ? settledLabel : runStatusLabel(status)}
        </span>
      </div>
      {isFailed && error && (
        <div className="cc-task-progress__message" style={{ color: 'var(--cc-error)' }}>
          {error}
        </div>
      )}
      {stillWaitingForInput && runId && (
        <div className="cc-run-status-card__reply">
          {inputOptions.length > 0 && (
            <div className="cc-run-status-card__options">
              {inputOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="cc-btn"
                  disabled={resume.isPending}
                  onClick={() => resume.mutate({ runId, followUp: option })}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {permissions.length > 0 && (
            <div className="cc-run-status-card__options">
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                disabled={resolvePermission.isPending}
                onClick={() => resolvePermission.mutate({ runId, decision: 'allow' })}
              >
                {translateUi('Allow')}
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--danger"
                disabled={resolvePermission.isPending}
                onClick={() => resolvePermission.mutate({ runId, decision: 'deny' })}
              >
                {translateUi('Deny')}
              </button>
            </div>
          )}
          <textarea
            rows={2}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={translateUi('Answer the agent')}
            aria-label={translateUi('Answer the agent')}
          />
          <div className="cc-task-progress__actions">
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              disabled={resume.isPending || !answer.trim()}
              onClick={() =>
                resume.mutate({ runId, followUp: answer }, { onSuccess: () => setAnswer('') })
              }
            >
              {translateUi('Send answer')}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--ghost"
              onClick={() => navigate(`/runs?run_id=${runId}`)}
            >
              {translateUi('Open run')}
            </button>
          </div>
        </div>
      )}
      {pendingReview && !approvedRun && (
        <div className="cc-run-status-card__reply">
          <textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={translateUi('Optional review note')}
            aria-label={translateUi('Optional review note')}
          />
          <div className="cc-task-progress__actions">
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              disabled={decide.isPending}
              onClick={() => decideItem(pendingReview, 'approved', note)}
            >
              {translateUi('Approve')}
            </button>
            <button
              type="button"
              className="cc-btn"
              disabled={decide.isPending || !note.trim()}
              title={translateUi('Your note becomes the follow-up instruction')}
              onClick={() => decideItem(pendingReview, 'changes_requested', note)}
            >
              {translateUi('Request changes')}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--danger"
              disabled={decide.isPending}
              onClick={() => decideItem(pendingReview, 'rejected', note)}
            >
              {translateUi('Reject')}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--ghost"
              onClick={() => navigate('/attention')}
            >
              {translateUi('Open review')}
            </button>
          </div>
        </div>
      )}
      {approvedRun && (
        <AgentRunReviewOutcomeHandoff
          projectId={approvedRun.projectId}
          taskTitle={approvedRun.taskTitle}
          outcome={approvedRun.outcome}
          onDismiss={dismissApprovedAgentRun}
        />
      )}
      {!live && (needsUser || isFailed) && runId && (
        <div className="cc-task-progress__actions">
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => navigate(`/runs?run_id=${runId}`)}
          >
            {translateUi('Open run')}
          </button>
        </div>
      )}
    </div>
  );
}
