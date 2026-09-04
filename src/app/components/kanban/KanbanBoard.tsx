import { useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import { useModuleStore } from '../../stores/useModuleStore';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';
import {
  useTodosQuery,
  useToggleTodoComplete,
  useDeleteTodo,
  useSetTaskStatus,
  useReorderTodos,
  useUpdateTodo,
} from '../../hooks/queries';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import usePlatform from '../../hooks/usePlatform';
import useKanbanKeyboardNav from '../../hooks/useKanbanKeyboardNav';
import useKanbanDragDrop from '../../hooks/useKanbanDragDrop';
import type { TaskStatus } from '../../types/api';
import { useKanbanShortcuts } from '../../keyboard';
import KanbanBoardView from './KanbanBoardView';
import type { TasksStatusFilter, TasksViewMode } from './TasksHeader';
import { ClipboardIcon, SpinArrowsIcon, CheckCircleIcon, CloseIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
import { isTaskTodo } from '../../utils/inboxState';
import useExperimentCompletionGate from '../../hooks/useExperimentCompletionGate';
interface KanbanBoardProps {
  viewMode: TasksViewMode;
  onViewModeChange: (mode: TasksViewMode) => void;
  statusFilter: TasksStatusFilter;
  onStatusFilterChange: (filter: TasksStatusFilter) => void;
}
export default function KanbanBoard({
  viewMode,
  onViewModeChange,
  statusFilter,
  onStatusFilterChange,
}: KanbanBoardProps) {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const { data: todos = [] } = useTodosQuery();
  const kanbanFilters = useModuleStore((s) => s.kanbanFilters);
  const selectedTodoIds = useModuleStore((s) => s.selectedTodoIds);
  const toggleTodoSelection = useModuleStore((s) => s.toggleTodoSelection);
  const clearTodoSelection = useModuleStore((s) => s.clearTodoSelection);
  const toggleMutation = useToggleTodoComplete();
  const { requestStatusChange, confirmationDialog } = useExperimentCompletionGate();
  const deleteMutation = useDeleteTodo();
  const setTaskStatusMutation = useSetTaskStatus();
  const reorderMutation = useReorderTodos();
  const updateTodoMutation = useUpdateTodo();
  const isMultiSelectMode = selectedTodoIds.size > 0;
  useKanbanShortcuts({ onNewTask: () => useQuickCaptureStore.getState().open() });
  useHotkeys(
    'Escape',
    () => {
      clearTodoSelection();
    },
    { enableOnFormTags: true },
  );
  const taskTodos = useMemo(() => todos.filter(isTaskTodo), [todos]);
  const scopedTodos = useMemo(
    () =>
      statusFilter === 'all' ? taskTodos : taskTodos.filter((todo) => todo.status === statusFilter),
    [statusFilter, taskTodos],
  );
  const filteredTodos = useKanbanFilters(scopedTodos, kanbanFilters);
  const visibleTodos = kanbanFilters.showSubTasks
    ? filteredTodos
    : filteredTodos.filter((t) => !t.parent_id);
  const todoTasks = useMemo(
    () => visibleTodos.filter((t) => t.status === 'pending'),
    [visibleTodos],
  );
  const inProgressTasks = useMemo(
    () => visibleTodos.filter((t) => t.status === 'in_progress'),
    [visibleTodos],
  );
  const doneTasks = useMemo(
    () => visibleTodos.filter((t) => t.status === 'completed'),
    [visibleTodos],
  );
  const cancelledTasks = useMemo(
    () => visibleTodos.filter((t) => t.status === 'cancelled'),
    [visibleTodos],
  );
  const allTasksFlat = useMemo(
    () => [...todoTasks, ...inProgressTasks, ...doneTasks, ...cancelledTasks],
    [todoTasks, inProgressTasks, doneTasks, cancelledTasks],
  );
  const handleToggle = useCallback(
    (id: string) => {
      const todo = todos.find((t) => t.id === id);
      if (todo) {
        const nextStatus = todo.status === 'completed' ? 'pending' : 'completed';
        requestStatusChange(todo, nextStatus, () =>
          toggleMutation.mutate({ id, currentStatus: todo.status }),
        );
      }
    },
    [requestStatusChange, todos, toggleMutation],
  );
  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );
  const { focusedTaskId, setFocusedTaskId } = useKanbanKeyboardNav({
    allTasksFlat,
    toggleTodoComplete: handleToggle,
    deleteTodo: handleDelete,
  });
  const handleSetTaskStatus = useCallback(
    (id: string, status: TaskStatus) => {
      const todo = todos.find((candidate) => candidate.id === id);
      if (!todo) return;
      requestStatusChange(todo, status, () => setTaskStatusMutation.mutate({ id, status }));
    },
    [requestStatusChange, setTaskStatusMutation, todos],
  );
  const handleReorder = useCallback(
    (todoId: string, newIndex: number, columnStatus: TaskStatus) => {
      const columnTodos = taskTodos
        .filter((t) => t.status === columnStatus && !t.parent_id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const fromIdx = columnTodos.findIndex((t) => t.id === todoId);
      if (fromIdx < 0) return;
      const [moved] = columnTodos.splice(fromIdx, 1);
      columnTodos.splice(newIndex, 0, moved);
      const updates: Record<string, number> = {};
      columnTodos.forEach((t, i) => {
        updates[t.id] = i;
      });
      reorderMutation.mutate({ updates });
    },
    [taskTodos, reorderMutation],
  );
  const handleSetParent = useCallback(
    (childId: string, parentId: string) => {
      updateTodoMutation.mutate({ id: childId, data: { parent_id: parentId } });
    },
    [updateTodoMutation],
  );
  const handleClearParent = useCallback(
    (childId: string) => {
      updateTodoMutation.mutate({ id: childId, data: { parent_id: null } });
    },
    [updateTodoMutation],
  );
  const getParentId = useCallback(
    (todoId: string) => {
      const todo = todos.find((t) => t.id === todoId);
      return todo?.parent_id ?? null;
    },
    [todos],
  );
  const getChildIds = useCallback(
    (todoId: string) => {
      return todos.filter((t) => t.parent_id === todoId).map((t) => t.id);
    },
    [todos],
  );
  const { handleDragStart, handleDragEnd } = useKanbanDragDrop({
    setTaskStatus: handleSetTaskStatus,
    reorderTodoInColumn: handleReorder,
    setParent: handleSetParent,
    clearParent: handleClearParent,
    getParentId,
    getChildIds,
  });
  const handleClickTask = (id: string) => navigate(`/tasks/${id}`);
  const handleMove = (id: string, status: TaskStatus) => handleSetTaskStatus(id, status);
  const columnDefs = [
    {
      status: 'in_progress' as const,
      title: translateUi('In Progress'),
      icon: <SpinArrowsIcon size={14} />,
      tasks: inProgressTasks,
    },
    {
      status: 'pending' as const,
      title: translateUi('Todo'),
      icon: <ClipboardIcon size={14} />,
      tasks: todoTasks,
    },
    {
      status: 'completed' as const,
      title: translateUi('Done'),
      icon: <CheckCircleIcon size={14} />,
      tasks: doneTasks,
    },
    {
      status: 'cancelled' as const,
      title: translateUi('Cancelled'),
      icon: <CloseIcon size={14} />,
      tasks: cancelledTasks,
    },
  ].filter((column) => statusFilter === 'all' || column.status === statusFilter);
  return (
    <>
      <KanbanBoardView
        todos={taskTodos}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        columnDefs={columnDefs}
        showSubTasks={kanbanFilters.showSubTasks}
        isMobile={isMobile}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onToggle={handleToggle}
        onClickTask={handleClickTask}
        focusedTaskId={focusedTaskId}
        onFocusTask={setFocusedTaskId}
        selectedIds={selectedTodoIds}
        onSelect={toggleTodoSelection}
        isMultiSelectMode={isMultiSelectMode}
        onMove={handleMove}
        onDelete={handleDelete}
      />
      {confirmationDialog}
    </>
  );
}
