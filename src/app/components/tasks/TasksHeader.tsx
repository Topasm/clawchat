import type { TodoResponse } from '../../types/api';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';
import usePlatform from '../../hooks/usePlatform';
import SegmentedControl from '../shared/SegmentedControl';
import { translateUi } from '../../i18n';
import { matchesTasksStatusFilter, type TasksStatusFilter } from '../../utils/taskStatus';
export { matchesTasksStatusFilter, taskStatusForColumn } from '../../utils/taskStatus';
export type { TasksColumnStatus, TasksStatusFilter } from '../../utils/taskStatus';
export const TASK_STATUS_FILTERS: TasksStatusFilter[] = ['active', 'completed', 'all'];
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
        <div className="cc-tasks-header__status-filter">
          <SegmentedControl
            ariaLabel={translateUi('Task status')}
            options={TASK_STATUS_FILTERS.map((status) => ({
              value: status,
              label: translateUi(
                status === 'active' ? 'Active' : status === 'completed' ? 'Done' : 'All',
              ),
            }))}
            value={statusFilter}
            onChange={(value) => onStatusFilterChange(value as TasksStatusFilter)}
          />
        </div>
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
