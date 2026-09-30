import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useProjectsQuery,
  useTaskExecutionTelemetryQuery,
  useTaskRelationshipsQuery,
  useTodosQuery,
  useToggleTodoComplete,
} from '../../hooks/queries';
import useProjectRootIds from '../../hooks/useProjectRootIds';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import { useModuleStore } from '../../stores/useModuleStore';
import KanbanFilterBar from '../kanban/KanbanFilterBar';
import TasksHeader, {
  matchesTasksStatusFilter,
  type TasksStatusFilter,
  type TasksViewMode,
} from '../kanban/TasksHeader';
import TaskListView from './TaskListView';
import { isTaskTodo } from '../../utils/inboxState';
import useExperimentCompletionGate from '../../hooks/useExperimentCompletionGate';

interface TaskListPageProps {
  viewMode: TasksViewMode;
  onViewModeChange: (mode: TasksViewMode) => void;
  statusFilter: TasksStatusFilter;
  onStatusFilterChange: (filter: TasksStatusFilter) => void;
}

export default function TaskListPage({
  viewMode,
  onViewModeChange,
  statusFilter,
  onStatusFilterChange,
}: TaskListPageProps) {
  const navigate = useNavigate();
  const { data: todos = [] } = useTodosQuery();
  const filters = useModuleStore((state) => state.kanbanFilters);
  const { data: projects = [] } = useProjectsQuery();
  const { data: relationships } = useTaskRelationshipsQuery();
  const { data: telemetry = [] } = useTaskExecutionTelemetryQuery();
  const projectRootIds = useProjectRootIds();
  const taskTodos = useMemo(
    () => todos.filter((todo) => isTaskTodo(todo) && !projectRootIds.has(todo.id)),
    [projectRootIds, todos],
  );
  const projectTitles = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title])),
    [projects],
  );
  const telemetryByTaskId = useMemo(
    () => new Map(telemetry.map((entry) => [entry.task_id, entry])),
    [telemetry],
  );
  // Same rule as the server's graph insights: an active task is blocked while
  // any prerequisite is not completed (a missing one counts as unfinished).
  const blockedIds = useMemo(() => {
    const statusById = new Map(todos.map((todo) => [todo.id, todo.status]));
    const blocked = new Set<string>();
    for (const edge of relationships ?? []) {
      if (edge.type !== 'depends_on') continue;
      const status = statusById.get(edge.source_task_id);
      if (status !== 'pending' && status !== 'in_progress') continue;
      if (statusById.get(edge.target_task_id) !== 'completed') blocked.add(edge.source_task_id);
    }
    return blocked;
  }, [relationships, todos]);
  const scopedTodos = useMemo(
    () => taskTodos.filter((todo) => matchesTasksStatusFilter(todo.status, statusFilter)),
    [statusFilter, taskTodos],
  );
  const filteredTodos = useKanbanFilters(scopedTodos, filters);
  const toggleTodo = useToggleTodoComplete();
  const { requestStatusChange, confirmationDialog } = useExperimentCompletionGate();
  const orderedTodos = useMemo(() => {
    const todoById = new Map(filteredTodos.map((todo) => [todo.id, todo]));
    const childrenById = new Map<string, typeof filteredTodos>();
    filteredTodos.forEach((todo) => {
      if (!todo.parent_id || !todoById.has(todo.parent_id)) return;
      childrenById.set(todo.parent_id, [...(childrenById.get(todo.parent_id) ?? []), todo]);
    });
    const ordered: typeof filteredTodos = [];
    const visited = new Set<string>();
    const visit = (todo: (typeof filteredTodos)[number]) => {
      if (visited.has(todo.id)) return;
      visited.add(todo.id);
      ordered.push(todo);
      childrenById.get(todo.id)?.forEach(visit);
    };
    filteredTodos.filter((todo) => !todo.parent_id || !todoById.has(todo.parent_id)).forEach(visit);
    filteredTodos.forEach(visit); // retain malformed/cyclic records
    return ordered;
  }, [filteredTodos]);

  return (
    <div>
      <TasksHeader
        todos={taskTodos}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        subtitle={`${filteredTodos.length} task${filteredTodos.length !== 1 ? 's' : ''} in a detailed list`}
      />
      <KanbanFilterBar showSubtaskToggle={false} />
      <TaskListView
        todos={orderedTodos}
        projectTitles={projectTitles}
        blockedIds={blockedIds}
        telemetryByTaskId={telemetryByTaskId}
        onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
        onToggleTask={(taskId) => {
          const todo = todos.find((candidate) => candidate.id === taskId);
          if (todo) {
            const nextStatus = todo.status === 'completed' ? 'pending' : 'completed';
            requestStatusChange(todo, nextStatus, () =>
              toggleTodo.mutate({ id: taskId, currentStatus: todo.status }),
            );
          }
        }}
      />
      {confirmationDialog}
    </div>
  );
}
