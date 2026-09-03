import { useMemo } from 'react';
import { useTaskRelationshipsQuery, useTodosQuery } from '../../hooks/queries';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import { useModuleStore } from '../../stores/useModuleStore';
import KanbanFilterBar from '../kanban/KanbanFilterBar';
import TasksHeader, { type TasksStatusFilter, type TasksViewMode } from '../kanban/TasksHeader';
import TaskGraph from './TaskGraph';
import { expandTaskGraphContext } from './taskGraphAdapter';
import { isTaskTodo } from '../../utils/inboxState';

interface TaskGraphPageProps {
  viewMode: TasksViewMode;
  onViewModeChange: (mode: TasksViewMode) => void;
  statusFilter: TasksStatusFilter;
  onStatusFilterChange: (filter: TasksStatusFilter) => void;
}

export default function TaskGraphPage({
  viewMode,
  onViewModeChange,
  statusFilter,
  onStatusFilterChange,
}: TaskGraphPageProps) {
  const { data: todos = [] } = useTodosQuery();
  const { data: relationships = [] } = useTaskRelationshipsQuery();
  const filters = useModuleStore((state) => state.kanbanFilters);
  const taskTodos = useMemo(() => todos.filter(isTaskTodo), [todos]);
  const scopedTodos = useMemo(
    () =>
      statusFilter === 'all' ? taskTodos : taskTodos.filter((todo) => todo.status === statusFilter),
    [statusFilter, taskTodos],
  );
  const filteredTodos = useKanbanFilters(scopedTodos, filters);
  const hasExternalFilter = Boolean(filters.searchQuery || filters.tags.length);

  // When a filter matches a child, retain its ancestors and visible
  // dependencies so the result still has useful graph context.
  const graphTodos = useMemo(() => {
    if (!hasExternalFilter) return filteredTodos;

    return expandTaskGraphContext(scopedTodos, filteredTodos, relationships);
  }, [filteredTodos, hasExternalFilter, relationships, scopedTodos]);

  return (
    <div>
      <TasksHeader
        todos={taskTodos}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        subtitle={`${graphTodos.length} task${graphTodos.length !== 1 ? 's' : ''} mapped by project and dependency`}
      />
      <KanbanFilterBar showSubtaskToggle={false} />
      <TaskGraph
        todos={graphTodos}
        metadataTodos={scopedTodos}
        relationships={relationships}
        hasExternalFilter={hasExternalFilter}
      />
    </div>
  );
}
