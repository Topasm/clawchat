import { useRef, useState } from 'react';
import { type TasksStatusFilter } from '../components/tasks/TasksHeader';
import { useTasksShortcuts } from '../keyboard';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import TaskListPage from '../components/task-list/TaskListPage';

export default function AllTasksPage() {
  const [statusFilter, setStatusFilter] = useState<TasksStatusFilter>('active');
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  useTasksShortcuts({ onNewTask: () => useQuickCaptureStore.getState().open() });

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

    // Swipe left shows completed tasks too; swipe right hides them again.
    setStatusFilter(dx < 0 ? 'all' : 'active');
  };

  return (
    <div className="cc-tasks-page" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <TaskListPage statusFilter={statusFilter} onStatusFilterChange={setStatusFilter} />
    </div>
  );
}
