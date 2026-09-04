import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentRunsQuery } from '../../hooks/queries';
import { runStatusLabel } from '../chat-panel/RunStatusCard';
import { translateUi } from '../../i18n';

/**
 * Where this task's agent work is right now, and the thread it reports into.
 *
 * The task page used to know nothing about runs: the only path from a task to
 * its execution went through the Inbox inspector. This is the short version --
 * the latest attempt's state and two links -- not another run monitor.
 */
export default function TaskAgentThreadSection({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const { data: runs = [] } = useAgentRunsQuery();
  const latest = useMemo(
    () =>
      runs
        .filter((run) => run.todo_id === taskId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
    [runs, taskId],
  );
  return (
    <div className="cc-exec-panel__section" data-testid="task-agent-thread">
      <div className="cc-exec-panel__section-title">{translateUi('Agent thread')}</div>
      {!latest ? (
        <div className="cc-exec-panel__next-step-empty">{translateUi('No agent runs yet.')}</div>
      ) : (
        <div className="cc-exec-panel__info-grid">
          <div className="cc-exec-panel__info-item">
            <span className="cc-exec-panel__info-label">{translateUi('Latest run')}</span>
            <span className={`cc-run-status cc-run-status--${latest.status}`}>
              {runStatusLabel(latest.status)}
            </span>
          </div>
          <div className="cc-exec-panel__info-item">
            <span className="cc-task-progress__actions">
              {latest.conversation_id && (
                <button
                  type="button"
                  className="cc-btn cc-btn--secondary"
                  onClick={() => navigate(`/chats/${latest.conversation_id}`)}
                >
                  {translateUi('Open thread')}
                </button>
              )}
              <button
                type="button"
                className="cc-btn cc-btn--ghost"
                onClick={() => navigate(`/runs?run_id=${latest.id}`)}
              >
                {translateUi('Open run')}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
