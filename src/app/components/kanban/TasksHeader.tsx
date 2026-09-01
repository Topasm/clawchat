import type { TaskStatus, TodoResponse } from '../../types/api';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';
import usePlatform from '../../hooks/usePlatform';
import SegmentedControl from '../shared/SegmentedControl';
import { translateUi } from '../../i18n';
export type TasksViewMode = 'kanban' | 'list' | 'graph';
export type TasksStatusFilter = TaskStatus | 'all';
export const TASK_STATUS_FILTERS: TasksStatusFilter[] = [
  'in_progress',
  'pending',
  'completed',
  'cancelled',
  'all',
];
interface TasksHeaderProps {
  todos: TodoResponse[];
  viewMode: TasksViewMode;
  onViewModeChange: (mode: TasksViewMode) => void;
  subtitle?: string;
  statusFilter: TasksStatusFilter;
  onStatusFilterChange: (filter: TasksStatusFilter) => void;
}
const VIEW_OPTIONS = [
  { label: 'Kanban', value: 'kanban' },
  { label: 'List', value: 'list' },
  { label: 'Graph', value: 'graph' },
];
export default function TasksHeader({
  todos,
  viewMode,
  onViewModeChange,
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
          {subtitle ?? `${todos.length} task${todos.length !== 1 ? 's' : ''} organised by status`}
        </div>
      </div>
      <div className="cc-tasks-header__actions">
        <div className="cc-tasks-header__status-filter">
          <SegmentedControl
            ariaLabel={translateUi('Task status')}
            options={TASK_STATUS_FILTERS.map((status) => ({
              value: status,
              label:
                status === 'all'
                  ? translateUi('All')
                  : translateUi(
                      status === 'in_progress'
                        ? 'In Progress'
                        : status === 'pending'
                          ? 'Todo'
                          : status === 'completed'
                            ? 'Done'
                            : 'Cancelled',
                    ),
            }))}
            value={statusFilter}
            onChange={(value) => onStatusFilterChange(value as TasksStatusFilter)}
          />
        </div>
        <div className="cc-tasks-header__view-filter">
          <SegmentedControl
            ariaLabel={translateUi('Task view')}
            options={VIEW_OPTIONS.map((option) => ({
              ...option,
              label: translateUi(option.label),
            }))}
            value={viewMode}
            onChange={(value) => onViewModeChange(value as TasksViewMode)}
          />
        </div>
        {!isMobile && (
          <button
            className="cc-btn cc-btn--primary"
            onClick={() => useQuickCaptureStore.getState().open()}
          >
            {translateUi('\n            + New Task\n          ')}
          </button>
        )}
      </div>
    </div>
  );
}
