import type { TaskExecutionTelemetryResponse, TodoResponse } from '../../types/api';
import StorageLocationBadge from '../shared/StorageLocationBadge';
import Checkbox from '../shared/Checkbox';
import { FlagIcon } from '../shared/Icons';
import { formatDueDate, isOverdue } from '../../utils/formatters';
import { translateUi } from '../../i18n';
import { describeTaskStage, getTaskStage } from '../../utils/taskStage';
import type { TaskStageState } from '../../utils/taskStage';
import { isWaitingOnPrerequisite } from '../../hooks/useTaskFilters';
interface TaskListViewProps {
  todos: TodoResponse[];
  /** Every task, so a row can count its steps even when they are filtered out. */
  allTodos?: TodoResponse[];
  onOpenTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  /** Project titles by id, for the row's second line. */
  projectTitles?: Map<string, string>;
  telemetryByTaskId?: Map<string, TaskExecutionTelemetryResponse>;
  /** The task open in the pane beside the list; its row stays raised. */
  selectedTaskId?: string | null;
}

/**
 * Where a task is among the five steps, from the task itself and the latest
 * run. A blocked task keeps its step but says why nothing is moving.
 */
export function describeTaskState(
  todo: TodoResponse,
  blocked: boolean,
  telemetry: TaskExecutionTelemetryResponse | undefined,
): { state: TaskStageState; label: string } {
  const state = getTaskStage({
    taskStatus: todo.status,
    inboxState: todo.inbox_state,
    runStatus: telemetry?.latest_run_status,
    pendingReviewCount: telemetry?.pending_review_count,
  });
  const label =
    blocked && !state.exception && state.stage !== 'done'
      ? translateUi('Blocked')
      : describeTaskStage(state);
  return { state, label };
}
function getTaskDepth(todo: TodoResponse, todoById: Map<string, TodoResponse>) {
  let depth = 0;
  let parentId = todo.parent_id;
  const visited = new Set([todo.id]);
  while (parentId && todoById.has(parentId) && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = todoById.get(parentId)?.parent_id;
  }
  return Math.min(depth, 4);
}

/**
 * One line per task, with a round check: the title, then in grey where it
 * stands, its project, what it waits on and when it is due. Colour appears
 * only where it means something -- a deadline, a question, a failure.
 */
export default function TaskListView({
  todos,
  allTodos = todos,
  onOpenTask,
  onToggleTask,
  projectTitles,
  telemetryByTaskId,
  selectedTaskId,
}: TaskListViewProps) {
  const todoById = new Map(todos.map((todo) => [todo.id, todo]));
  const steps = new Map<string, { done: number; total: number }>();
  for (const todo of allTodos) {
    if (!todo.parent_id || todo.status === 'cancelled') continue;
    const entry = steps.get(todo.parent_id) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (todo.status === 'completed') entry.done += 1;
    steps.set(todo.parent_id, entry);
  }
  if (todos.length === 0) {
    return (
      <div className="cc-task-list__empty">
        {translateUi('No tasks match the current filters.')}
      </div>
    );
  }
  return (
    <div className="cc-task-rows" role="list" aria-label={translateUi('Task list')}>
      {todos.map((todo) => {
        const done = todo.status === 'completed';
        // The server names the unfinished prerequisites, so the row can say
        // what it waits on; the line goes away once they are completed.
        const waitingOn = isWaitingOnPrerequisite(todo) ? (todo.open_prerequisites ?? []) : [];
        const blocked = waitingOn.length > 0;
        const { state, label } = describeTaskState(todo, blocked, telemetryByTaskId?.get(todo.id));
        const depth = getTaskDepth(todo, todoById);
        const context =
          (todo.project_id ? projectTitles?.get(todo.project_id) : null) ||
          todo.project_label ||
          (todo.parent_id ? todoById.get(todo.parent_id)?.title : null);
        // A captured task says nothing about its step; a finished one neither.
        const showState =
          Boolean(state.exception) ||
          blocked ||
          (state.stage !== 'capture' && state.stage !== 'done' && !done);
        const running = state.stage === 'run' && !state.exception && !blocked && !done;
        const overdue = Boolean(todo.due_date) && !done && isOverdue(todo.due_date!);
        return (
          <div
            key={todo.id}
            className={`cc-task-row cc-task-row--${state.stage}${done ? ' cc-task-row--done' : ''}${todo.id === selectedTaskId ? ' cc-task-row--selected' : ''}`}
            role="listitem"
            aria-current={todo.id === selectedTaskId ? 'true' : undefined}
            style={depth > 0 ? { marginLeft: depth * 22 } : undefined}
          >
            <Checkbox checked={done} onChange={() => onToggleTask(todo.id)} />
            <button type="button" className="cc-task-row__main" onClick={() => onOpenTask(todo.id)}>
              <span className="cc-task-row__title">{todo.title}</span>
              <span className="cc-task-row__meta">
                {steps.has(todo.id) && (
                  <span className="cc-task-row__steps">
                    {translateUi('{{done}}/{{total}} steps', steps.get(todo.id)!)}
                  </span>
                )}
                {showState && (
                  <span
                    className={`cc-task-row__state${state.exception ? ` cc-task-row__state--${state.exception}` : ''}`}
                  >
                    {running && <i className="cc-task-row__dot" aria-hidden="true" />}
                    {label}
                  </span>
                )}
                {context && (
                  <span className="cc-task-row__context" title={context}>
                    {context}
                  </span>
                )}
                {blocked && (
                  <small
                    className="cc-task-row__waiting"
                    title={waitingOn.map((entry) => entry.title).join(', ')}
                  >
                    {translateUi('Waiting on {{title}}', {
                      title:
                        waitingOn.length === 1
                          ? waitingOn[0].title
                          : translateUi('{{title}} +{{count}}', {
                              title: waitingOn[0].title,
                              count: waitingOn.length - 1,
                            }),
                    })}
                  </small>
                )}
                {todo.due_date && (
                  <span
                    className={`cc-task-row__due${overdue ? ' cc-task-row__due--overdue' : ''}`}
                  >
                    <FlagIcon size={11} className="cc-task-row__flag" />
                    {formatDueDate(todo.due_date)}
                  </span>
                )}
                <StorageLocationBadge item={todo} />
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
