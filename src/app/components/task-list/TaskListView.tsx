import type { TaskExecutionTelemetryResponse, TodoResponse } from '../../types/api';
import StorageLocationBadge from '../shared/StorageLocationBadge';
import { formatDueDate } from '../../utils/formatters';
import { translateUi } from '../../i18n';
import { describeTaskStage, getTaskStage } from '../../utils/taskStage';
import type { TaskStageState } from '../../utils/taskStage';
import TaskStageIndicator from '../shared/TaskStageIndicator';
interface TaskListViewProps {
  todos: TodoResponse[];
  /** Every task, so a row can count its steps even when they are filtered out. */
  allTodos?: TodoResponse[];
  onOpenTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  /** Project titles by id, for the Project column. */
  projectTitles?: Map<string, string>;
  /** Active tasks with an unfinished prerequisite. */
  blockedIds?: Set<string>;
  telemetryByTaskId?: Map<string, TaskExecutionTelemetryResponse>;
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
export default function TaskListView({
  todos,
  allTodos = todos,
  onOpenTask,
  onToggleTask,
  projectTitles,
  blockedIds,
  telemetryByTaskId,
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
    <div className="cc-task-list" role="table" aria-label={translateUi('Task list')}>
      <div className="cc-task-list__header" role="row">
        <span role="columnheader">{translateUi('Task')}</span>
        <span role="columnheader">{translateUi('Status')}</span>
        <span role="columnheader">{translateUi('Project / tag')}</span>
        <span role="columnheader">{translateUi('Due')}</span>
      </div>
      {todos.map((todo) => {
        const status = todo.status;
        const { state, label } = describeTaskState(
          todo,
          blockedIds?.has(todo.id) ?? false,
          telemetryByTaskId?.get(todo.id),
        );
        const depth = getTaskDepth(todo, todoById);
        const context =
          (todo.project_id ? projectTitles?.get(todo.project_id) : null) ||
          todo.project_label ||
          todo.tags?.[0] ||
          (todo.parent_id ? todoById.get(todo.parent_id)?.title : null);
        return (
          <div
            key={todo.id}
            className={`cc-task-list__row cc-task-list__row--${state.stage}`}
            role="row"
            tabIndex={0}
            onClick={() => onOpenTask(todo.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpenTask(todo.id);
              }
            }}
          >
            <span
              className="cc-task-list__task"
              role="cell"
              style={{ paddingLeft: 12 + depth * 22 }}
            >
              <input
                type="checkbox"
                checked={status === 'completed'}
                onChange={() => onToggleTask(todo.id)}
                onClick={(event) => event.stopPropagation()}
                aria-label={translateUi(
                  status === 'completed' ? 'Mark {{title}} incomplete' : 'Mark {{title}} complete',
                  { title: todo.title },
                )}
              />
              {depth > 0 && <i className="cc-task-list__branch" aria-hidden="true" />}
              <strong>{todo.title}</strong>
              {steps.has(todo.id) && (
                <span className="cc-task-list__steps">
                  {translateUi('{{done}}/{{total}} steps', steps.get(todo.id)!)}
                </span>
              )}
              <StorageLocationBadge item={todo} />
            </span>
            <span role="cell">
              <TaskStageIndicator state={state} label={label} />
            </span>
            <span role="cell" title={context ?? undefined}>
              {context || '—'}
            </span>
            <span
              role="cell"
              className={
                todo.due_date && formatDueDate(todo.due_date) === 'Overdue'
                  ? 'cc-task-list__overdue'
                  : ''
              }
            >
              {todo.due_date ? formatDueDate(todo.due_date) : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
