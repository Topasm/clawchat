import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useProjectsQuery,
  useTaskExecutionTelemetryQuery,
  useTodosQuery,
  useToggleTodoComplete,
} from '../../hooks/queries';
import useProjectRootIds from '../../hooks/useProjectRootIds';
import useTaskFilters from '../../hooks/useTaskFilters';
import { useModuleStore } from '../../stores/useModuleStore';
import TasksHeader, {
  matchesTasksStatusFilter,
  type TasksStatusFilter,
} from '../tasks/TasksHeader';
import TaskListView from './TaskListView';
import { isTaskTodo } from '../../utils/inboxState';
import useExperimentCompletionGate from '../../hooks/useExperimentCompletionGate';

interface TaskListPageProps {
  statusFilter: TasksStatusFilter;
  onStatusFilterChange: (filter: TasksStatusFilter) => void;
}

export default function TaskListPage({ statusFilter, onStatusFilterChange }: TaskListPageProps) {
  const navigate = useNavigate();
  const { data: todos = [] } = useTodosQuery();
  const filters = useModuleStore((state) => state.kanbanFilters);
  const { data: projects = [] } = useProjectsQuery();
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
  const scopedTodos = useMemo(
    () => taskTodos.filter((todo) => matchesTasksStatusFilter(todo.status, statusFilter)),
    [statusFilter, taskTodos],
  );
  const filteredTodos = useTaskFilters(scopedTodos, filters);
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
      <TasksHeader statusFilter={statusFilter} onStatusFilterChange={onStatusFilterChange} />
      <TaskListView
        todos={orderedTodos}
        allTodos={todos}
        projectTitles={projectTitles}
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
