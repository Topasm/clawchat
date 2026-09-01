import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useCreateTodo, useTodosQuery, useToggleTodoComplete, queryKeys } from '../hooks/queries';
import { translateUi } from '../i18n';
import { useAuthStore } from '../stores/useAuthStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { TodoResponse } from '../types/api';
import { formatDueDate } from '../utils/formatters';
import { CalendarIcon, CheckIcon, ExpandIcon, PlusIcon } from './shared/Icons';
import '../../styles/_simple-mode.css';
import { isTaskTodo } from '../utils/inboxState';

type SimpleTaskFilter = 'open' | 'completed';

function taskTimestamp(todo: TodoResponse): number {
  if (todo.due_date) {
    const due = new Date(todo.due_date).getTime();
    if (!Number.isNaN(due)) return due;
  }
  return Number.MAX_SAFE_INTEGER;
}

export default function SimpleMode() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: todos = [], isLoading } = useTodosQuery();
  const createTodo = useCreateTodo();
  const toggleTodo = useToggleTodoComplete();
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const setSimpleMode = useSettingsStore((state) => state.setSimpleMode);
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState<SimpleTaskFilter>('open');

  const visibleTodos = useMemo(
    () =>
      todos
        .filter(isTaskTodo)
        .filter((todo) =>
          filter === 'completed'
            ? todo.status === 'completed'
            : todo.status === 'pending' || todo.status === 'in_progress',
        )
        .sort((left, right) => {
          const dueDifference = taskTimestamp(left) - taskTimestamp(right);
          if (dueDifference !== 0) return dueDifference;
          return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        }),
    [filter, todos],
  );
  const taskTodos = todos.filter(isTaskTodo);
  const openCount = taskTodos.filter(
    (todo) => todo.status === 'pending' || todo.status === 'in_progress',
  ).length;
  const completedCount = taskTodos.filter((todo) => todo.status === 'completed').length;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    if (serverUrl) {
      createTodo.mutate({
        title: trimmedTitle,
        status: 'pending',
        priority: 'medium',
        tags: [],
        source: 'quick_capture',
        inbox_state: 'classifying',
      });
    } else {
      const now = new Date().toISOString();
      const optimisticTodo: TodoResponse = {
        id: `local-${Date.now()}`,
        title: trimmedTitle,
        status: 'pending',
        priority: 'medium',
        tags: [],
        parent_id: null,
        project_id: null,
        sort_order: 0,
        created_at: now,
        updated_at: now,
      };
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (current) => [
        optimisticTodo,
        ...(current ?? []),
      ]);
    }
    setTitle('');
    setFilter('open');
  };

  const handleToggle = (todo: TodoResponse) => {
    if (!serverUrl || todo.id.startsWith('local-')) {
      const nextStatus = todo.status === 'completed' ? 'pending' : 'completed';
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (current) =>
        (current ?? []).map((item) =>
          item.id === todo.id
            ? { ...item, status: nextStatus, updated_at: new Date().toISOString() }
            : item,
        ),
      );
      return;
    }
    toggleTodo.mutate({ id: todo.id, currentStatus: todo.status });
  };

  const expand = () => {
    setSimpleMode(false);
    navigate('/tasks');
  };

  return (
    <main className="cc-simple-mode">
      <header className="cc-simple-mode__header">
        <div className="cc-simple-mode__title">
          <h1>{translateUi('Tasks')}</h1>
          <p>{translateUi('{{count}} open tasks', { count: openCount })}</p>
        </div>
        <button
          type="button"
          className="cc-simple-mode__expand"
          onClick={expand}
          title={translateUi('Switch to expanded mode')}
          aria-label={translateUi('Switch to expanded mode')}
        >
          <ExpandIcon size={16} />
        </button>
      </header>

      <form className="cc-simple-mode__capture" onSubmit={handleSubmit}>
        <PlusIcon size={16} className="cc-simple-mode__capture-icon" />
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={translateUi('Add a task…')}
          aria-label={translateUi('Task title')}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!title.trim() || createTodo.isPending}
          aria-label={translateUi('Add task')}
        >
          {translateUi('Add')}
        </button>
      </form>

      <div className="cc-simple-mode__filters" role="group" aria-label={translateUi('Task filter')}>
        <button
          type="button"
          className={filter === 'open' ? 'cc-simple-mode__filter--active' : undefined}
          aria-pressed={filter === 'open'}
          onClick={() => setFilter('open')}
        >
          {translateUi('Open')} <span>{openCount}</span>
        </button>
        <button
          type="button"
          className={filter === 'completed' ? 'cc-simple-mode__filter--active' : undefined}
          aria-pressed={filter === 'completed'}
          onClick={() => setFilter('completed')}
        >
          {translateUi('Done')} <span>{completedCount}</span>
        </button>
      </div>

      <div className="cc-simple-mode__list" aria-live="polite">
        {isLoading ? (
          <p className="cc-simple-mode__empty">{translateUi('Loading tasks…')}</p>
        ) : visibleTodos.length === 0 ? (
          <div className="cc-simple-mode__empty">
            <strong>
              {filter === 'open' ? translateUi('No open tasks') : translateUi('No completed tasks')}
            </strong>
            <span>
              {filter === 'open'
                ? translateUi('Add a task above when something comes up.')
                : translateUi('Completed tasks will appear here.')}
            </span>
          </div>
        ) : (
          visibleTodos.map((todo) => (
            <label
              key={todo.id}
              className={`cc-simple-mode__task${todo.status === 'completed' ? ' cc-simple-mode__task--completed' : ''}`}
            >
              <input
                className="cc-simple-mode__task-input"
                type="checkbox"
                checked={todo.status === 'completed'}
                onChange={() => handleToggle(todo)}
                aria-label={translateUi(
                  todo.status === 'completed'
                    ? 'Mark {{title}} incomplete'
                    : 'Mark {{title}} complete',
                  { title: todo.title },
                )}
              />
              <span className="cc-simple-mode__check" aria-hidden="true">
                <CheckIcon size={12} />
              </span>
              <span className="cc-simple-mode__task-copy">
                <strong>{todo.title}</strong>
                {todo.due_date && (
                  <small>
                    <CalendarIcon size={12} />
                    {formatDueDate(todo.due_date)}
                  </small>
                )}
              </span>
            </label>
          ))
        )}
      </div>

      {connectionStatus !== 'connected' && (
        <footer className="cc-simple-mode__footer" aria-live="polite">
          <span className={`cc-simple-mode__status cc-simple-mode__status--${connectionStatus}`} />
          <span>{translateUi('Working offline')}</span>
        </footer>
      )}
    </main>
  );
}
