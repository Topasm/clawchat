import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/useChatStore';
import { translateUi } from '../../i18n';
interface TaskProgressCardProps {
  taskId: string;
  /** The run the delegation started; the live progress may name a later attempt. */
  runId?: string;
  isMultiAgent?: boolean;
}
export default function TaskProgressCard({ taskId, runId, isMultiAgent }: TaskProgressCardProps) {
  const navigate = useNavigate();
  const progress = useChatStore((s) => s.taskProgress[taskId]);
  const label = isMultiAgent ? translateUi('Multi-Agent Task') : translateUi('Background Task');
  if (!progress) {
    return (
      <div className="cc-task-progress">
        <div className="cc-task-progress__header">
          <span className="cc-task-progress__label">{label}</span>
          <span className="cc-task-progress__percent">{translateUi('Queued')}</span>
        </div>
        <div className="cc-task-progress__bar">
          <div className="cc-task-progress__fill" style={{ width: '0%' }} />
        </div>
      </div>
    );
  }
  const pct = progress.progress ?? 0;
  const status = progress.status ?? 'running';
  // The run decides what "done" means: a top-level result waits for review
  // first, and a run can stop to ask for input. Both are the user's turn.
  const isDone = status === 'completed';
  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';
  const needsReview = status === 'waiting_review';
  const needsInput = status === 'waiting_input';
  const needsUser = needsReview || needsInput;
  const settled = isDone || isFailed || isCancelled || needsReview;
  const activeRunId = progress.run_id ?? runId;
  const statusLabel = needsReview
    ? translateUi('Waiting for review')
    : needsInput
      ? translateUi('Needs your input')
      : isDone
        ? translateUi('Complete')
        : isCancelled
          ? translateUi('Cancelled')
          : isFailed
            ? translateUi('Failed')
            : `${pct}%`;
  return (
    <div className={`cc-task-progress${needsUser ? ' cc-task-progress--attention' : ''}`}>
      <div className="cc-task-progress__header">
        <span className="cc-task-progress__label">{label}</span>
        <span className="cc-task-progress__percent">{statusLabel}</span>
      </div>

      <div className="cc-task-progress__bar">
        <div
          className="cc-task-progress__fill"
          style={{
            width: `${settled ? 100 : pct}%`,
            background: isFailed ? 'var(--cc-error)' : needsUser ? 'var(--cc-warning)' : undefined,
          }}
        />
      </div>

      {progress.message && <div className="cc-task-progress__message">{progress.message}</div>}

      {(isDone || needsReview) && progress.result && (
        <div
          className="cc-task-progress__message"
          style={{ marginTop: 8, color: 'var(--cc-text)' }}
        >
          {progress.result}
        </div>
      )}

      {isFailed && progress.error && (
        <div
          className="cc-task-progress__message"
          style={{ marginTop: 8, color: 'var(--cc-error)' }}
        >
          {progress.error}
        </div>
      )}

      {(needsUser || (isFailed && activeRunId)) && (
        <div className="cc-task-progress__actions">
          {needsReview && (
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={() => navigate('/attention')}
            >
              {translateUi('Review result')}
            </button>
          )}
          {needsInput && activeRunId && (
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={() => navigate(`/runs?run_id=${activeRunId}`)}
            >
              {translateUi('Reply to agent')}
            </button>
          )}
          {activeRunId && (
            <button
              type="button"
              className="cc-btn cc-btn--ghost"
              onClick={() => navigate(`/runs?run_id=${activeRunId}`)}
            >
              {translateUi('Open run')}
            </button>
          )}
        </div>
      )}

      {isMultiAgent && progress.sub_tasks && progress.sub_tasks.length > 0 && (
        <div className="cc-task-progress__subtasks">
          {progress.sub_tasks.map((sub) => (
            <div key={sub.id} className="cc-task-progress__subtask">
              <span
                className={`cc-task-progress__subtask-dot cc-task-progress__subtask-dot--${sub.status}`}
              />
              <span>{sub.instruction}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
