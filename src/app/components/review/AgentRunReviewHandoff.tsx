import type { AgentRunApprovalImpact, AgentRunReviewOutcome } from '../../types/api';

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
      aria-label={isApplied ? 'Agent approval outcome' : 'Agent approval impact'}
      role={isApplied ? 'status' : undefined}
    >
      <div className="cc-agent-review-handoff__topline">
        <span>{isApplied ? 'Approval applied' : 'Approval impact'}</span>
        {graphRevision !== undefined && <span>Graph revision {graphRevision}</span>}
      </div>

      <strong>
        {isApplied
          ? outcome?.todo_status === 'completed'
            ? 'Task completed'
            : 'Agent result approved'
          : todoId
            ? `Completes ${completedLabel}`
            : 'Approves this Agent result'}
      </strong>

      <p>
        {readyCount > 0
          ? `${readyCount} downstream task${readyCount === 1 ? '' : 's'} ${isApplied ? (readyCount === 1 ? 'is now' : 'are now') : 'will become'} Ready.`
          : isApplied
            ? 'No downstream tasks became Ready from this approval.'
            : 'No downstream tasks are expected to become Ready yet.'}
      </p>

      {readyCount > 0 && (
        <ul className="cc-agent-review-handoff__tasks" aria-label="Newly Ready tasks">
          {newlyReadyTasks.map((task) => (
            <li key={task.id}>
              {isApplied ? (
                <button
                  type="button"
                  aria-label={`Open ${task.title}`}
                  onClick={() => onOpenTask(task.id)}
                >
                  {task.title}
                  <span>Open task</span>
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
              Open completed task
            </button>
          )}
          <button className="cc-btn cc-btn--primary" type="button" onClick={onOpenInbox}>
            Open Inbox
          </button>
        </div>
      )}
    </section>
  );
}
