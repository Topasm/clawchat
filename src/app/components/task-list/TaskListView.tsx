import type { TodoResponse } from '../../types/api';
import { formatDueDate } from '../../utils/formatters';
import { translateUi } from '../../i18n';
interface TaskListViewProps {
  todos: TodoResponse[];
  onOpenTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
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
export default function TaskListView({ todos, onOpenTask, onToggleTask }: TaskListViewProps) {
  const todoById = new Map(todos.map((todo) => [todo.id, todo]));
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
        <span role="columnheader">{translateUi('Priority')}</span>
        <span role="columnheader">{translateUi('Project / tag')}</span>
        <span role="columnheader">{translateUi('Due')}</span>
      </div>
      {todos.map((todo) => {
        const status = todo.status;
        const depth = getTaskDepth(todo, todoById);
        const context =
          todo.project_label ||
          todo.tags?.[0] ||
          (todo.parent_id ? todoById.get(todo.parent_id)?.title : null);
        return (
          <div
            key={todo.id}
            className={`cc-task-list__row cc-task-list__row--${status}`}
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
            </span>
            <span role="cell">
              <i className={`cc-task-list__status cc-task-list__status--${status}`} />
              {status.replace('_', ' ')}
            </span>
            <span role="cell">
              <i
                className={`cc-task-list__priority cc-task-list__priority--${todo.priority ?? 'medium'}`}
              />
              {todo.priority ?? 'medium'}
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
