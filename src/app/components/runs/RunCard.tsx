import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAgentRunEventsQuery,
  useCancelAgentRun,
  useReturnAgentRunToReady,
  useRetryAgentRun,
  useResumeAgentRun,
} from '../../hooks/queries';
import type { AgentRunResponse } from '../../types/api';
import { translateUi } from '../../i18n';

const ACTIVE_STATUSES = new Set(['queued', 'starting', 'running', 'waiting_input']);

/** A run that ended without an adopted result: failed, cancelled, or rejected. */
export function isUnsuccessfulRun(run: AgentRunResponse): boolean {
  return (
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    (run.status === 'completed' && !run.is_adopted)
  );
}

/** Whether the user can still do something about an unsuccessful run. */
export function needsRecoveryDecision(run: AgentRunResponse): boolean {
  return isUnsuccessfulRun(run) && (!run.todo_id || run.todo_status === 'in_progress');
}

interface RunCardProps {
  run: AgentRunResponse;
  expanded: boolean;
  onToggle: () => void;
  onReview: () => void;
}

/**
 * One execution attempt with everything the user can do to it.
 *
 * Shared by the Runs log and the Attention page: answering a waiting run,
 * retrying, cancelling and handing a task back to the queue happen in the
 * same card wherever the run is listed.
 */
export default function RunCard({ run, expanded, onToggle, onReview }: RunCardProps) {
  const navigate = useNavigate();
  const cancel = useCancelAgentRun();
  const retry = useRetryAgentRun();
  const returnToReady = useReturnAgentRunToReady();
  const resume = useResumeAgentRun();
  const [followUp, setFollowUp] = useState('');
  const active = ACTIVE_STATUSES.has(run.status);
  const unsuccessful = isUnsuccessfulRun(run);
  const canRetry = unsuccessful && (!run.todo_id || run.todo_status === 'in_progress');
  const canReturnToReady = Boolean(
    unsuccessful && run.todo_id && run.todo_status === 'in_progress',
  );
  return (
    <article className={`cc-run-card cc-run-card--${run.status}`}>
      <div className="cc-run-card__header">
        <div className="cc-run-card__identity">
          <span className={`cc-run-status cc-run-status--${run.status}`}>
            {run.status.replaceAll('_', ' ')}
          </span>
          <h2>{run.todo_title || run.instruction_snapshot}</h2>
          <p>
            {run.project_title || translateUi('Unscoped')}
            {translateUi(' · attempt ')}
            {run.attempt} · {run.provider}
            {run.model ? ` / ${run.model}` : ''}
          </p>
          {run.provider === 'paseo' && (run.host_id || run.workspace_id || run.external_run_id) && (
            <p className="cc-run-card__external">
              {run.host_id || translateUi('Paseo')}
              {run.workspace_id ? translateUi(' · workspace {{id}}', { id: run.workspace_id }) : ''}
              {run.external_run_id
                ? translateUi(' · agent {{id}}', { id: run.external_run_id })
                : ''}
            </p>
          )}
        </div>
        {run.is_adopted && <span className="cc-run-card__adopted">{translateUi('Adopted')}</span>}
      </div>
      <div
        className="cc-run-progress"
        aria-label={translateUi('{{progress}}% complete', { progress: run.progress })}
      >
        <span style={{ width: `${run.progress}%` }} />
      </div>
      <div className="cc-run-card__status-line">
        <span>{run.progress_message || translateUi('No progress message')}</span>
        {run.heartbeat_at && (
          <span>
            {translateUi('Heartbeat ')}
            {new Date(run.heartbeat_at).toLocaleTimeString()}
          </span>
        )}
      </div>
      {run.error && <p className="cc-run-card__error">{run.error}</p>}
      {run.result_summary && <pre className="cc-run-card__result">{run.result_summary}</pre>}
      {run.status === 'waiting_input' && (
        <textarea
          rows={2}
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          placeholder={translateUi('Add follow-up instructions before retrying')}
          aria-label={translateUi('Answer the agent')}
        />
      )}
      <div className="cc-run-card__actions">
        <button type="button" className="cc-btn" onClick={onToggle}>
          {expanded ? translateUi('Hide log') : translateUi('Event log')}
        </button>
        {run.conversation_id && (
          <button
            type="button"
            className="cc-btn"
            onClick={() => navigate(`/chats/${run.conversation_id}`)}
          >
            {translateUi('Open thread')}
          </button>
        )}
        {active && run.status !== 'waiting_input' && (
          <button
            type="button"
            className="cc-btn cc-btn--danger"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(run.id)}
          >
            {translateUi('\n            Cancel\n          ')}
          </button>
        )}
        {run.status === 'waiting_input' && (
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={resume.isPending || !followUp.trim()}
            onClick={() => resume.mutate({ runId: run.id, followUp })}
          >
            {translateUi('\n            Resume with follow-up\n          ')}
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ runId: run.id })}
          >
            {translateUi('\n            Retry\n          ')}
          </button>
        )}
        {canReturnToReady && (
          <button
            type="button"
            className="cc-btn"
            disabled={returnToReady.isPending}
            onClick={() => returnToReady.mutate(run.id)}
          >
            {translateUi('\n            Return task to queue\n          ')}
          </button>
        )}
        {run.status === 'waiting_review' && (
          <button type="button" className="cc-btn cc-btn--primary" onClick={onReview}>
            {translateUi('\n            Review result\n          ')}
          </button>
        )}
      </div>
      {expanded && <RunEventLog runId={run.id} />}
    </article>
  );
}

export function RunEventLog({ runId }: { runId: string }) {
  const { data: events = [], isLoading } = useAgentRunEventsQuery(runId);
  if (isLoading) return <div className="cc-run-events">{translateUi('Loading event log…')}</div>;
  return (
    <ol className="cc-run-events">
      {events.map((event) => (
        <li key={event.id}>
          <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleTimeString()}</time>
          <strong>{event.event_type.replaceAll('_', ' ')}</strong>
          <span>{event.message || (event.progress != null ? `${event.progress}%` : '')}</span>
        </li>
      ))}
    </ol>
  );
}
