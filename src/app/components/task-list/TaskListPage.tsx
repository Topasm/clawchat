import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTodosQuery, useToggleTodoComplete } from '../../hooks/queries';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import { useModuleStore } from '../../stores/useModuleStore';
import KanbanFilterBar from '../kanban/KanbanFilterBar';
import TasksHeader, { type TasksViewMode } from '../kanban/TasksHeader';
import TaskListView from './TaskListView';

interface TaskListPageProps {
  viewMode: TasksViewMode;
  onViewModeChange: (mode: TasksViewMode) => void;
}

export default function TaskListPage({ viewMode, onViewModeChange }: TaskListPageProps) {
  const navigate = useNavigate();
  const { data: todos = [] } = useTodosQuery();
  const kanbanStatuses = useModuleStore((state) => state.kanbanStatuses);
  const filters = useModuleStore((state) => state.kanbanFilters);
  const filteredTodos = useKanbanFilters(todos, kanbanStatuses, filters);
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
        todos={todos}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        subtitle={`${filteredTodos.length} task${filteredTodos.length !== 1 ? 's' : ''} in a detailed list`}
      />
      <KanbanFilterBar showSubtaskToggle={false} />
      <TaskListView
        todos={orderedTodos}
        kanbanStatuses={kanbanStatuses}
        onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
        onToggleTask={(taskId) => {
          const todo = todos.find((candidate) => candidate.id === taskId);
          if (todo) toggleTodo.mutate({ id: taskId, currentStatus: todo.status });
        }}
      />
    </div>
  );
}
