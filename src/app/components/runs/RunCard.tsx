import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAgentRunEventsQuery,
  useCancelAgentRun,
  useReturnAgentRunToReady,
  useRetryAgentRun,
  useResumeAgentRun,
} from '../../hooks/queries';
import ToolRequestPanel from './ToolRequestPanel';
import type { AgentRunResponse } from '../../types/api';
import { translateUi } from '../../i18n';
import { skillChainLabel } from '../../utils/skillLabels';
import { relativeTime } from '../../utils/formatters';
import { agentName, getRunStage } from '../../utils/taskStage';
import TaskStageIndicator from '../shared/TaskStageIndicator';

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
  const pendingTool = run.status === 'waiting_input' ? run.pending_tool_call : null;
  const answering = run.status === 'waiting_input' && !pendingTool;
  const active = ACTIVE_STATUSES.has(run.status);
  const unsuccessful = isUnsuccessfulRun(run);
  const canRetry = unsuccessful && (!run.todo_id || run.todo_status === 'in_progress');
  const canReturnToReady = Boolean(
    unsuccessful && run.todo_id && run.todo_status === 'in_progress',
  );
  const updatedAt = run.updated_at ?? run.created_at;
  const stage = getRunStage(run);
  const details = [
    run.project_title || translateUi('No project'),
    run.skill_chain?.length ? skillChainLabel(run.skill_chain) : null,
    translateUi('attempt {{attempt}}', { attempt: run.attempt }),
    run.host_label ? translateUi('on {{host}}', { host: run.host_label }) : null,
    run.model ? `${run.provider} / ${run.model}` : run.provider,
    run.workspace_id ? translateUi('workspace {{id}}', { id: run.workspace_id }) : null,
    run.external_run_id
      ? run.provider === 'opencode'
        ? translateUi('session {{id}}', { id: run.external_run_id })
        : translateUi('agent {{id}}', { id: run.external_run_id })
      : null,
    run.heartbeat_at
      ? translateUi('last heard from {{time}}', {
          time: new Date(run.heartbeat_at).toLocaleTimeString(),
        })
      : null,
  ].filter(Boolean);
  return (
    <article className={`cc-run-card cc-run-card--${run.status}`}>
      <div className="cc-run-card__header">
        <div className="cc-run-card__identity">
          <h2>{run.todo_title || run.instruction_snapshot}</h2>
          <p>
            <TaskStageIndicator state={stage} />
            <span className="cc-run-card__fact">
              {agentName(run.provider)}
              {/* Where a failed run ran is part of deciding what to do about it. */}
              {stage.exception === 'failed' && run.host_label
                ? ` ${translateUi('on {{host}}', { host: run.host_label })}`
                : ''}
              {` · ${relativeTime(updatedAt)}`}
            </span>
          </p>
        </div>
      </div>
      {run.status === 'running' && (
        <div
          className="cc-run-progress"
          aria-label={translateUi('{{progress}}% complete', { progress: run.progress })}
        >
          <span style={{ width: `${run.progress}%` }} />
        </div>
      )}
      {run.progress_message && !pendingTool && active && (
        <div className="cc-run-card__status-line">
          <span>{run.progress_message}</span>
        </div>
      )}
      {run.error && <p className="cc-run-card__error">{run.error}</p>}
      {run.result_summary && <pre className="cc-run-card__result">{run.result_summary}</pre>}
      {pendingTool && <ToolRequestPanel runId={run.id} request={pendingTool} />}
      {answering && (
        <textarea
          rows={2}
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          placeholder={translateUi('Your answer')}
          aria-label={translateUi('Your answer')}
        />
      )}
      <div className="cc-run-card__actions">
        {answering && (
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={resume.isPending || !followUp.trim()}
            onClick={() => resume.mutate({ runId: run.id, followUp })}
          >
            {translateUi('Send answer')}
          </button>
        )}
        {run.status === 'waiting_review' && (
          <button type="button" className="cc-btn cc-btn--primary" onClick={onReview}>
            {translateUi('Check result')}
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ runId: run.id })}
          >
            {translateUi('Retry')}
          </button>
        )}
        {run.conversation_id && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => navigate(`/chats/${run.conversation_id}`)}
          >
            {translateUi('Open thread')}
          </button>
        )}
        {canReturnToReady && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            disabled={returnToReady.isPending}
            onClick={() => returnToReady.mutate(run.id)}
          >
            {translateUi('Return task to queue')}
          </button>
        )}
        {active && run.status !== 'waiting_input' && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(run.id)}
          >
            {translateUi('Cancel')}
          </button>
        )}
        <button
          type="button"
          className="cc-btn cc-btn--ghost"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {translateUi('Details')}
        </button>
      </div>
      {expanded && (
        <>
          <p className="cc-run-card__external">{details.join(' · ')}</p>
          <RunEventLog runId={run.id} />
        </>
      )}
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
