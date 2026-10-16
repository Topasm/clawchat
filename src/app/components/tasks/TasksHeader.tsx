import { translateUi } from '../../i18n';
import { TasksIcon } from '../shared/NavIcons';
import TaskViewMenu from './TaskFilterBar';
import type { TasksStatusFilter } from '../../utils/taskStatus';
export { matchesTasksStatusFilter, taskStatusForColumn } from '../../utils/taskStatus';
export type { TasksColumnStatus, TasksStatusFilter } from '../../utils/taskStatus';
interface TasksHeaderProps {
  statusFilter: TasksStatusFilter;
  onStatusFilterChange: (filter: TasksStatusFilter) => void;
}
/** The page title with its icon, and the one "View" control beside it. */
export default function TasksHeader({ statusFilter, onStatusFilterChange }: TasksHeaderProps) {
  return (
    <div className="cc-page-header cc-page-header--flush cc-tasks-header">
      <h1 className="cc-page-header__title cc-page-header__title--icon">
        <TasksIcon className="cc-page-header__icon cc-page-header__icon--tasks" />
        {translateUi('Tasks')}
      </h1>
      <TaskViewMenu statusFilter={statusFilter} onStatusFilterChange={onStatusFilterChange} />
    </div>
  );
}
