import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProjectsQuery, useTaskRelationshipsQuery, useTodosQuery } from '../../hooks/queries';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import { useModuleStore } from '../../stores/useModuleStore';
import KanbanFilterBar from '../kanban/KanbanFilterBar';
import TasksHeader, { type TasksStatusFilter, type TasksViewMode } from '../kanban/TasksHeader';
import TaskGraph from './TaskGraph';
import { expandTaskGraphContext } from './taskGraphAdapter';
import { isTaskTodo } from '../../utils/inboxState';
import { translateUi } from '../../i18n';

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
  const projectsQuery = useProjectsQuery();
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedProjectId = searchParams.get('project_id');
  const selectedProject = projects.find((project) => project.id === requestedProjectId) ?? null;
  const filters = useModuleStore((state) => state.kanbanFilters);
  const taskTodos = useMemo(() => todos.filter(isTaskTodo), [todos]);
  const graphScopeTodos = useMemo(
    () =>
      selectedProject
        ? taskTodos.filter(
            (todo) =>
              todo.project_id === selectedProject.id && todo.id !== selectedProject.root_task_id,
          )
        : taskTodos,
    [selectedProject, taskTodos],
  );
  const scopedTodos = useMemo(
    () =>
      statusFilter === 'all'
        ? graphScopeTodos
        : graphScopeTodos.filter((todo) => todo.status === statusFilter),
    [graphScopeTodos, statusFilter],
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
      <div className="cc-task-flow__project-picker">
        <label>
          <span>{translateUi('Project')}</span>
          <select
            aria-label={translateUi('Filter graph by project')}
            value={selectedProject?.id ?? 'all'}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              if (event.target.value === 'all') next.delete('project_id');
              else next.set('project_id', event.target.value);
              setSearchParams(next);
            }}
          >
            <option value="all">{translateUi('All tasks')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <TaskGraph
        todos={graphTodos}
        metadataTodos={graphScopeTodos}
        relationships={relationships}
        hasExternalFilter={hasExternalFilter}
        fixedProjectId={selectedProject?.id ?? 'all'}
        initialMode="execution"
        showPlanningAction={false}
      />
    </div>
  );
}
