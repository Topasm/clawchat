import type { TodoResponse } from '../../types/api';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';
import usePlatform from '../../hooks/usePlatform';
import { translateUi } from '../../i18n';
import { matchesTasksStatusFilter, type TasksStatusFilter } from '../../utils/taskStatus';
export { matchesTasksStatusFilter, taskStatusForColumn } from '../../utils/taskStatus';
export type { TasksColumnStatus, TasksStatusFilter } from '../../utils/taskStatus';
interface TasksHeaderProps {
  todos: TodoResponse[];
  subtitle?: string;
  statusFilter: TasksStatusFilter;
  onStatusFilterChange: (filter: TasksStatusFilter) => void;
}
export default function TasksHeader({
  todos,
  subtitle,
  statusFilter,
  onStatusFilterChange,
}: TasksHeaderProps) {
  const { isMobile } = usePlatform();
  return (
    <div className="cc-page-header cc-tasks-header">
      <div>
        <div className="cc-page-header__title">{translateUi('Tasks')}</div>
        <div className="cc-page-header__subtitle">
          {subtitle ??
            translateUi('{{count}} tasks', {
              count: todos.filter((todo) => matchesTasksStatusFilter(todo.status, statusFilter))
                .length,
            })}
        </div>
      </div>
      <div className="cc-tasks-header__actions">
        <label className="cc-tasks-header__status-filter cc-tasks-header__show-done">
          <input
            type="checkbox"
            checked={statusFilter !== 'active'}
            onChange={(event) => onStatusFilterChange(event.target.checked ? 'all' : 'active')}
          />
          {translateUi('Show completed')}
        </label>
        {!isMobile && (
          <button
            className="cc-btn cc-btn--primary"
            onClick={() => useQuickCaptureStore.getState().open()}
          >
            {translateUi('+ Task')}
          </button>
        )}
      </div>
    </div>
  );
}
