import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTodosQuery, useToggleTodoComplete } from '../../hooks/queries';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import { useModuleStore } from '../../stores/useModuleStore';
import KanbanFilterBar from '../kanban/KanbanFilterBar';
import TasksHeader, { type TasksStatusFilter, type TasksViewMode } from '../kanban/TasksHeader';
import TaskListView from './TaskListView';
import { isTaskTodo } from '../../utils/inboxState';

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
  const taskTodos = useMemo(() => todos.filter(isTaskTodo), [todos]);
  const scopedTodos = useMemo(
    () =>
      statusFilter === 'all' ? taskTodos : taskTodos.filter((todo) => todo.status === statusFilter),
    [statusFilter, taskTodos],
  );
  const filteredTodos = useKanbanFilters(scopedTodos, filters);
  const toggleTodo = useToggleTodoComplete();
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
        onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
        onToggleTask={(taskId) => {
          const todo = todos.find((candidate) => candidate.id === taskId);
          if (todo) toggleTodo.mutate({ id: taskId, currentStatus: todo.status });
        }}
      />
    </div>
  );
}
