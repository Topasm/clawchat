import { useChatStore } from '../../stores/useChatStore';
import { translateUi } from '../../i18n';
interface TaskProgressCardProps {
  taskId: string;
  isMultiAgent?: boolean;
}
export default function TaskProgressCard({ taskId, isMultiAgent }: TaskProgressCardProps) {
  const progress = useChatStore((s) => s.taskProgress[taskId]);
  if (!progress) {
    return (
      <div className="cc-task-progress">
        <div className="cc-task-progress__header">
          <span className="cc-task-progress__label">
            {isMultiAgent ? translateUi('Multi-Agent Task') : translateUi('Background Task')}
          </span>
          <span className="cc-task-progress__percent">{translateUi('Queued')}</span>
        </div>
        <div className="cc-task-progress__bar">
          <div className="cc-task-progress__fill" style={{ width: '0%' }} />
        </div>
      </div>
    );
  }
  const pct = progress.progress ?? 0;
  const isDone = progress.status === 'completed';
  const isFailed = progress.status === 'failed';
  return (
    <div className="cc-task-progress">
      <div className="cc-task-progress__header">
        <span className="cc-task-progress__label">
          {isMultiAgent ? translateUi('Multi-Agent Task') : translateUi('Background Task')}
        </span>
        <span className="cc-task-progress__percent">
          {isDone ? translateUi('Complete') : isFailed ? translateUi('Failed') : `${pct}%`}
        </span>
      </div>

      <div className="cc-task-progress__bar">
        <div
          className="cc-task-progress__fill"
          style={{
            width: `${isDone ? 100 : pct}%`,
            background: isFailed ? 'var(--cc-error)' : undefined,
          }}
        />
      </div>

      {progress.message && <div className="cc-task-progress__message">{progress.message}</div>}

      {isDone && progress.result && (
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
