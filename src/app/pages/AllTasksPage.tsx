import { useRef, useState } from 'react';
import KanbanBoard from '../components/kanban/KanbanBoard';
import {
  TASK_STATUS_FILTERS,
  type TasksStatusFilter,
  type TasksViewMode,
} from '../components/kanban/TasksHeader';
import TaskListPage from '../components/task-list/TaskListPage';
import TaskGraphPage from '../components/task-graph/TaskGraphPage';

const TASKS_VIEW_STORAGE_KEY = 'clawchat.tasksView';

export default function AllTasksPage() {
  const [statusFilter, setStatusFilter] = useState<TasksStatusFilter>('in_progress');
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<TasksViewMode>(() => {
    try {
      const stored = localStorage.getItem(TASKS_VIEW_STORAGE_KEY);
      if (stored === 'graph' || stored === 'list') return stored;
      return 'kanban';
    } catch {
      return 'kanban';
    }
  });

  const handleViewModeChange = (mode: TasksViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(TASKS_VIEW_STORAGE_KEY, mode);
    } catch {
      // The view still works when storage is unavailable.
    }
  };

  const sharedProps = {
    viewMode,
    onViewModeChange: handleViewModeChange,
    statusFilter,
    onStatusFilterChange: setStatusFilter,
  };
  const content =
    viewMode === 'graph' ? (
      <TaskGraphPage {...sharedProps} />
    ) : viewMode === 'list' ? (
      <TaskListPage {...sharedProps} />
    ) : (
      <KanbanBoard {...sharedProps} />
    );

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'input, textarea, button, [role="button"], [contenteditable="true"], .cc-swipe-actions',
      )
    ) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    touchStartX.current = event.touches[0].clientX;
    touchStartY.current = event.touches[0].clientY;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (touchStartX.current == null || touchStartY.current == null) return;
    const dx = event.changedTouches[0].clientX - touchStartX.current;
    const dy = event.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2) return;

    const activeIndex = TASK_STATUS_FILTERS.indexOf(statusFilter);
    if (dx < 0 && activeIndex < TASK_STATUS_FILTERS.length - 1) {
      setStatusFilter(TASK_STATUS_FILTERS[activeIndex + 1]);
    } else if (dx > 0 && activeIndex > 0) {
      setStatusFilter(TASK_STATUS_FILTERS[activeIndex - 1]);
    }
  };

  return (
    <div className="cc-tasks-page" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {content}
    </div>
  );
}
