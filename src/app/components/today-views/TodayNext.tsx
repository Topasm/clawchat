import { useNavigate } from 'react-router-dom';
import { useTodosQuery } from '../../hooks/queries';
import { translateUi } from '../../i18n';
import { isInboxTodo, isTaskTodo } from '../../utils/inboxState';
import { isTerminalTaskStatus } from '../../utils/taskStatus';
import { ChevronRightIcon } from '../shared/Icons';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What to do once today is clear: sort what is waiting in the inbox, and look
 * at what is due later this week. A line shows only when it has something.
 */
export default function TodayNext() {
  const navigate = useNavigate();
  const { data: todos = [] } = useTodosQuery();
  const now = Date.now();
  const inboxCount = todos.filter(isInboxTodo).length;
  const dueThisWeek = todos.filter((todo) => {
    if (!todo.due_date || !isTaskTodo(todo) || isTerminalTaskStatus(todo.status)) return false;
    const due = new Date(todo.due_date).getTime();
    return due > now && due - now <= WEEK_MS;
  }).length;
  const lines = [
    inboxCount > 0 && {
      key: 'inbox',
      label: translateUi('Sort the inbox'),
      count: inboxCount,
      to: '/inbox',
    },
    dueThisWeek > 0 && {
      key: 'week',
      label: translateUi('Due this week'),
      count: dueThisWeek,
      to: '/schedule/week',
    },
  ].filter(Boolean) as Array<{ key: string; label: string; count: number; to: string }>;
  if (lines.length === 0) return null;
  return (
    <div className="cc-today-next" aria-label={translateUi('Next')}>
      {lines.map((line) => (
        <button
          key={line.key}
          type="button"
          className="cc-today-next__row"
          onClick={() => navigate(line.to)}
        >
          <span>{line.label}</span>
          <span className="cc-today-next__count">{line.count}</span>
          <ChevronRightIcon size={14} />
        </button>
      ))}
    </div>
  );
}
