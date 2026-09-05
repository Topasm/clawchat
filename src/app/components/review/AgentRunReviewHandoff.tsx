import { useState } from 'react';
import type { AgentRunApprovalImpact, AgentRunReviewOutcome } from '../../types/api';
import { translateUi } from '../../i18n';

interface StartedRun {
  run_id: string;
}

interface AgentRunReviewHandoffProps {
  taskTitle?: string | null;
  impact?: AgentRunApprovalImpact | null;
  outcome?: AgentRunReviewOutcome | null;
  onOpenTask: (taskId: string) => void;
  onRunNext?: (task: { id: string; title: string }) => Promise<StartedRun | null>;
  canRunNext?: boolean;
  isStartingNext?: boolean;
  onChooseAnother?: () => void;
  onStop?: () => void;
  onOpenRun?: (runId: string) => void;
}
export default function AgentRunReviewHandoff({
  taskTitle,
  impact,
  outcome,
  onOpenTask,
  onRunNext,
  canRunNext = false,
  isStartingNext = false,
  onChooseAnother,
  onStop,
  onOpenRun,
}: AgentRunReviewHandoffProps) {
  const [startedRun, setStartedRun] = useState<StartedRun | null>(null);
  if (!impact && !outcome) return null;
  const isApplied = Boolean(outcome);
  const todoId = outcome?.todo_id ?? impact?.todo_id;
  const graphRevision = outcome?.graph_revision ?? impact?.graph_revision;
  const newlyReadyTasks = outcome?.newly_ready_tasks ?? impact?.newly_ready_tasks ?? [];
  const readyCount = newlyReadyTasks.length;
  const nextTask = readyCount === 1 ? newlyReadyTasks[0] : undefined;
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
          {startedRun ? (
            <>
              {onOpenRun && (
                <button
                  className="cc-btn cc-btn--primary"
                  type="button"
                  onClick={() => onOpenRun(startedRun.run_id)}
                >
                  {translateUi('Open started run')}
                </button>
              )}
              {onChooseAnother && (
                <button className="cc-btn" type="button" onClick={onChooseAnother}>
                  {translateUi('Back to project')}
                </button>
              )}
              {onStop && (
                <button className="cc-btn cc-btn--ghost" type="button" onClick={onStop}>
                  {translateUi('Done')}
                </button>
              )}
            </>
          ) : nextTask && onRunNext ? (
            <>
              <button
                className="cc-btn cc-btn--primary"
                type="button"
                disabled={!canRunNext || isStartingNext}
                title={
                  canRunNext
                    ? translateUi('Start “{{title}}” with the Project defaults', {
                        title: nextTask.title,
                      })
                    : translateUi('Preparing the next Ready task…')
                }
                onClick={async () => {
                  const result = await onRunNext(nextTask);
                  if (result) setStartedRun(result);
                }}
              >
                {isStartingNext ? translateUi('Starting…') : translateUi('Run next')}
              </button>
              {onChooseAnother && (
                <button className="cc-btn" type="button" onClick={onChooseAnother}>
                  {translateUi('Choose another')}
                </button>
              )}
              {onStop && (
                <button className="cc-btn cc-btn--ghost" type="button" onClick={onStop}>
                  {translateUi('Stop here')}
                </button>
              )}
            </>
          ) : (
            <>
              {readyCount > 1 && onChooseAnother && (
                <button className="cc-btn cc-btn--primary" type="button" onClick={onChooseAnother}>
                  {translateUi('Choose another')}
                </button>
              )}
              {todoId && (
                <button className="cc-btn" type="button" onClick={() => onOpenTask(todoId)}>
                  {translateUi('Open completed task')}
                </button>
              )}
              {onStop && (
                <button className="cc-btn cc-btn--primary" type="button" onClick={onStop}>
                  {translateUi('Done')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
