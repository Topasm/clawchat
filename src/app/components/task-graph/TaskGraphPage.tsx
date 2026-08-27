import { useMemo } from 'react';
import { useTaskRelationshipsQuery, useTodosQuery } from '../../hooks/queries';
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
  const { data: relationships = [] } = useTaskRelationshipsQuery();
  const filters = useModuleStore((state) => state.kanbanFilters);
  const filteredTodos = useKanbanFilters(todos, filters);
  const hasExternalFilter = Boolean(
    filters.searchQuery || filters.priorities.length || filters.tags.length,
  );

  // When a filter matches a child, retain its ancestors and visible
  // dependencies so the result still has useful graph context.
  const graphTodos = useMemo(() => {
    if (!hasExternalFilter) return filteredTodos;

    return expandTaskGraphContext(todos, filteredTodos, relationships);
  }, [filteredTodos, hasExternalFilter, relationships, todos]);

  return (
    <div>
      <TasksHeader
        todos={todos}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        subtitle={`${graphTodos.length} task${graphTodos.length !== 1 ? 's' : ''} mapped by project and dependency`}
      />
      <KanbanFilterBar showSubtaskToggle={false} />
      <TaskGraph
        todos={graphTodos}
        metadataTodos={todos}
        relationships={relationships}
        hasExternalFilter={hasExternalFilter}
      />
    </div>
  );
}
