import type { AgentRunApprovalImpact, AgentRunReviewOutcome } from '../../types/api';
import { translateUi } from '../../i18n';
interface AgentRunReviewHandoffProps {
  taskTitle?: string | null;
  impact?: AgentRunApprovalImpact | null;
  outcome?: AgentRunReviewOutcome | null;
  onOpenTask: (taskId: string) => void;
  onOpenInbox: () => void;
}
export default function AgentRunReviewHandoff({
  taskTitle,
  impact,
  outcome,
  onOpenTask,
  onOpenInbox,
}: AgentRunReviewHandoffProps) {
  if (!impact && !outcome) return null;
  const isApplied = Boolean(outcome);
  const todoId = outcome?.todo_id ?? impact?.todo_id;
  const graphRevision = outcome?.graph_revision ?? impact?.graph_revision;
  const newlyReadyTasks = outcome?.newly_ready_tasks ?? impact?.newly_ready_tasks ?? [];
  const readyCount = newlyReadyTasks.length;
  const completedLabel = taskTitle ? `“${taskTitle}”` : 'The linked task';
  return (
    <section
      className={`cc-agent-review-handoff${isApplied ? ' cc-agent-review-handoff--applied' : ''}`}
      aria-label={
        isApplied ? translateUi('Agent approval outcome') : translateUi('Agent approval impact')
      }
      role={isApplied ? 'status' : undefined}
    >
      <div className="cc-agent-review-handoff__topline">
        <span>{isApplied ? translateUi('Approval applied') : translateUi('Approval impact')}</span>
        {graphRevision !== undefined && (
          <span>
            {translateUi('Graph revision ')}
            {graphRevision}
          </span>
        )}
      </div>

      <strong>
        {isApplied
          ? outcome?.todo_status === 'completed'
            ? translateUi('Task completed')
            : translateUi('Agent result approved')
          : todoId
            ? translateUi('Completes {{title}}', { title: completedLabel })
            : translateUi('Approves this Agent result')}
      </strong>

      <p>
        {readyCount > 0
          ? translateUi(
              isApplied
                ? readyCount === 1
                  ? '1 downstream task is now Ready.'
                  : '{{count}} downstream tasks are now Ready.'
                : readyCount === 1
                  ? '1 downstream task will become Ready.'
                  : '{{count}} downstream tasks will become Ready.',
              { count: readyCount },
            )
          : isApplied
            ? translateUi('No downstream tasks became Ready from this approval.')
            : translateUi('No downstream tasks are expected to become Ready yet.')}
      </p>

      {readyCount > 0 && (
        <ul
          className="cc-agent-review-handoff__tasks"
          aria-label={translateUi('Newly Ready tasks')}
        >
          {newlyReadyTasks.map((task) => (
            <li key={task.id}>
              {isApplied ? (
                <button
                  type="button"
                  aria-label={translateUi('Open {{title}}', { title: task.title })}
                  onClick={() => onOpenTask(task.id)}
                >
                  {task.title}
                  <span>{translateUi('Open task')}</span>
                </button>
              ) : (
                <span>{task.title}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {isApplied && (
        <div className="cc-agent-review-handoff__actions">
          {todoId && (
            <button className="cc-btn" type="button" onClick={() => onOpenTask(todoId)}>
              {translateUi('\n              Open completed task\n            ')}
            </button>
          )}
          <button className="cc-btn cc-btn--primary" type="button" onClick={onOpenInbox}>
            {translateUi('\n            Open Inbox\n          ')}
          </button>
        </div>
      )}
    </section>
  );
}
