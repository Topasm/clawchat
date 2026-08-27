import { useMemo } from 'react';
import { useTodosQuery } from '../../hooks/queries';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import { useModuleStore } from '../../stores/useModuleStore';
import KanbanFilterBar from '../kanban/KanbanFilterBar';
import TasksHeader, { type TasksViewMode } from '../kanban/TasksHeader';
import TaskGraph from './TaskGraph';
import { expandTaskGraphContext } from './taskGraphAdapter';

interface TaskGraphPageProps {
  viewMode: TasksViewMode;
  onViewModeChange: (mode: TasksViewMode) => void;
}

export default function TaskGraphPage({ viewMode, onViewModeChange }: TaskGraphPageProps) {
  const { data: todos = [] } = useTodosQuery();
  const kanbanStatuses = useModuleStore((state) => state.kanbanStatuses);
  const filters = useModuleStore((state) => state.kanbanFilters);
  const filteredTodos = useKanbanFilters(todos, kanbanStatuses, filters);

  // When a filter matches a child, retain its ancestors and visible
  // dependencies so the result still has useful graph context.
  const graphTodos = useMemo(() => {
    const hasNarrowingFilter = Boolean(
      filters.searchQuery || filters.priorities.length || filters.tags.length,
    );
    if (!hasNarrowingFilter) return filteredTodos;

    return expandTaskGraphContext(todos, filteredTodos);
  }, [filteredTodos, filters.priorities.length, filters.searchQuery, filters.tags.length, todos]);

  return (
    <div>
      <TasksHeader
        todos={todos}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        subtitle={`${graphTodos.length} task${graphTodos.length !== 1 ? 's' : ''} mapped by project and dependency`}
      />
      <KanbanFilterBar showSubtaskToggle={false} />
      <TaskGraph todos={graphTodos} metadataTodos={todos} kanbanStatuses={kanbanStatuses} />
    </div>
  );
}
