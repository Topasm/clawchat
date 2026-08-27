import { useState } from 'react';
import KanbanBoard from '../components/kanban/KanbanBoard';
import type { TasksViewMode } from '../components/kanban/TasksHeader';
import TaskListPage from '../components/task-list/TaskListPage';
import TaskGraphPage from '../components/task-graph/TaskGraphPage';

const TASKS_VIEW_STORAGE_KEY = 'clawchat.tasksView';

export default function AllTasksPage() {
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

  if (viewMode === 'graph') {
    return <TaskGraphPage viewMode={viewMode} onViewModeChange={handleViewModeChange} />;
  }
  if (viewMode === 'list') {
    return <TaskListPage viewMode={viewMode} onViewModeChange={handleViewModeChange} />;
  }
  return <KanbanBoard viewMode={viewMode} onViewModeChange={handleViewModeChange} />;
}
