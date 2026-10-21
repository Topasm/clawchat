import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAgentRunEventsQuery,
  useAgentRunsQuery,
  useCancelAgentRun,
  useRetryAgentRun,
} from '../../hooks/queries';
import type { AgentRunResponse } from '../../types/api';
import { translateUi } from '../../i18n';
import { relativeTime } from '../../utils/formatters';
import { agentName, describeTaskStage, getRunStage } from '../../utils/taskStage';
import { runFailureReason } from '../../utils/runFailure';

/**
 * Where this task's agent work is right now, and the thread it reports into.
 *
 * One line of fact -- which agent, where it got to, when -- and at most one
 * highlighted button: the thing the run is waiting on the user for. A task
 * that has never run gets no section: "no runs yet" is not news.
 */
export default function TaskAgentThreadSection({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const retry = useRetryAgentRun();
  const { data: runs = [] } = useAgentRunsQuery();
  const latest = useMemo(
    () =>
      runs
        .filter((run) => run.todo_id === taskId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
    [runs, taskId],
  );
  if (!latest) return null;
  const openRun = () => navigate(`/attention?view=runs&run_id=${latest.id}`);
  if (ACTIVE_RUN.has(latest.status)) return <LiveRunCard run={latest} onOpenRun={openRun} />;
  const stage = getRunStage(latest);
  const updatedAt = latest.updated_at ?? latest.created_at;
  return (
    <div className="cc-exec-panel__section" data-testid="task-agent-thread">
      <div className="cc-exec-panel__section-title">{translateUi('Agent run')}</div>
      <p className="cc-exec-panel__run-fact">
        {agentName(latest.provider)} · {describeTaskStage(stage)}
        {updatedAt ? ` · ${relativeTime(updatedAt)}` : ''}
      </p>
      {latest.status === 'failed' && (
        <p className="cc-exec-panel__run-failure" role="status">
          {runFailureReason(latest.error)}
        </p>
      )}
      <span className="cc-task-progress__actions">
        {latest.status === 'waiting_input' && (
          <button type="button" className="cc-btn cc-btn--primary" onClick={openRun}>
            {translateUi('Answer')}
          </button>
        )}
        {latest.status === 'waiting_review' && (
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            onClick={() => navigate('/attention')}
          >
            {translateUi('Check result')}
          </button>
        )}
        {latest.status === 'failed' && latest.todo_status === 'in_progress' && (
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ runId: latest.id })}
          >
            {translateUi('Retry')}
          </button>
        )}
        {latest.conversation_id && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => navigate(`/chats/${latest.conversation_id}`)}
          >
            {translateUi('Open thread')}
          </button>
        )}
        <button type="button" className="cc-btn cc-btn--ghost" onClick={openRun}>
          {translateUi('Open run')}
        </button>
      </span>
    </div>
  );
}

const ACTIVE_RUN = new Set(['queued', 'starting', 'running']);
/** Lifecycle events say nothing the card does not; the log shows the work. */
const LIFECYCLE_EVENTS = new Set(['queued', 'starting', 'running']);

/** Enough of the log's end to hold the last two steps past lifecycle events. */
const LIVE_EVENTS_TAIL = 20;
/** "N min in" moves by the minute; a run that goes quiet must not freeze it. */
const ELAPSED_TICK_MS = 30_000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** "3분째" / "3 min in"; "방금 시작" for the first minute. */
export function runElapsedLabel(startedAt: string | null | undefined, now = Date.now()): string {
  if (!startedAt) return translateUi('Waiting to start');
  const minutes = Math.floor((now - new Date(startedAt).getTime()) / 60_000);
  if (minutes < 1) return translateUi('Just started');
  return translateUi('{{minutes}} min in', { minutes });
}

/**
 * A run at work, as the design's step 3 draws it: a green dot, the agent,
 * how long it has been going and where, the last two things it did, then
 * Stop and the full run log.
 */
function LiveRunCard({ run, onOpenRun }: { run: AgentRunResponse; onOpenRun: () => void }) {
  const cancel = useCancelAgentRun();
  const { data: events = [] } = useAgentRunEventsQuery(run.id, true, LIVE_EVENTS_TAIL);
  const now = useNow(ELAPSED_TICK_MS);
  const recent = events
    .filter((event) => !LIFECYCLE_EVENTS.has(event.event_type) && event.message)
    .slice(-2);
  const stopping = cancel.isPending || !!run.cancel_requested_at;
  return (
    <div className="cc-exec-panel__section" data-testid="task-agent-thread">
      <div className="cc-exec-panel__section-title">{translateUi('Agent run')}</div>
      <div className="cc-run-live" role="status">
        <div className="cc-run-live__head">
          <span className="cc-run-live__dot" aria-hidden="true" />
          <b>{agentName(run.provider)}</b>
          <span className="cc-run-live__meta">
            · {runElapsedLabel(run.started_at, now)}
            {run.host_label ? ` · ${run.host_label}` : ''}
          </span>
        </div>
        {recent.length > 0 && (
          <div className="cc-run-live__log">
            {recent.map((event) => (
              <span key={event.id}>{translateUi(event.message ?? '')}</span>
            ))}
          </div>
        )}
      </div>
      <span className="cc-task-progress__actions">
        <button
          type="button"
          className="cc-btn cc-btn--secondary"
          disabled={stopping}
          onClick={() => cancel.mutate(run.id)}
        >
          {stopping ? translateUi('Stopping…') : translateUi('Stop run')}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--ghost cc-run-live__link"
          onClick={onOpenRun}
        >
          {translateUi('Full run log')}
        </button>
      </span>
    </div>
  );
}
