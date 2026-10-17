import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentRunsQuery, useRetryAgentRun } from '../../hooks/queries';
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
