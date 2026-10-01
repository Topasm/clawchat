import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  TASK_STATUS_FILTERS,
  type TasksStatusFilter,
  type TasksViewMode,
} from '../components/tasks/TasksHeader';
import { useTasksShortcuts } from '../keyboard';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import TaskListPage from '../components/task-list/TaskListPage';
import TaskGraphPage from '../components/task-graph/TaskGraphPage';

const TASKS_VIEW_STORAGE_KEY = 'clawchat.tasksView';

export default function AllTasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<TasksStatusFilter>('active');
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  // The Kanban board is gone; links and saved preferences that name it land on the list.
  const [viewMode, setViewMode] = useState<TasksViewMode>(() => {
    const requested = searchParams.get('view');
    if (requested === 'graph' || requested === 'list') return requested;
    if (requested === 'kanban') return 'list';
    try {
      const stored = localStorage.getItem(TASKS_VIEW_STORAGE_KEY);
      return stored === 'graph' ? 'graph' : 'list';
    } catch {
      return 'list';
    }
  });
  useTasksShortcuts({ onNewTask: () => useQuickCaptureStore.getState().open() });

  useEffect(() => {
    const requested = searchParams.get('view');
    const next = requested === 'kanban' ? 'list' : requested;
    if ((next === 'graph' || next === 'list') && next !== viewMode) setViewMode(next);
  }, [searchParams, viewMode]);

  const handleViewModeChange = (mode: TasksViewMode) => {
    setViewMode(mode);
    const next = new URLSearchParams(searchParams);
    next.set('view', mode);
    setSearchParams(next);
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
    viewMode === 'graph' ? <TaskGraphPage {...sharedProps} /> : <TaskListPage {...sharedProps} />;

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, button, [role="button"], [contenteditable="true"]')) {
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
