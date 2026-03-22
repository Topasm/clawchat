import { useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import { useModuleStore } from '../../stores/useModuleStore';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';
import { useTodosQuery, useToggleTodoComplete, useDeleteTodo, useSetKanbanStatus, useReorderTodos } from '../../hooks/queries';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import usePlatform from '../../hooks/usePlatform';
import useKanbanKeyboardNav from '../../hooks/useKanbanKeyboardNav';
import useKanbanDragDrop from '../../hooks/useKanbanDragDrop';
import type { KanbanStatus } from '../../types/api';
import { useKanbanShortcuts } from '../../keyboard';
import KanbanBoardView from './KanbanBoardView';
import { ClipboardIcon, SpinArrowsIcon, CheckCircleIcon } from '../shared/Icons';

export default function KanbanBoard() {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const { data: todos = [] } = useTodosQuery();
  const kanbanStatuses = useModuleStore((s) => s.kanbanStatuses);
  const kanbanFilters = useModuleStore((s) => s.kanbanFilters);
  const selectedTodoIds = useModuleStore((s) => s.selectedTodoIds);
  const toggleTodoSelection = useModuleStore((s) => s.toggleTodoSelection);
  const clearTodoSelection = useModuleStore((s) => s.clearTodoSelection);

  const toggleMutation = useToggleTodoComplete();
  const deleteMutation = useDeleteTodo();
  const setKanbanStatusMutation = useSetKanbanStatus();
  const reorderMutation = useReorderTodos();

  const isMultiSelectMode = selectedTodoIds.size > 0;

  useKanbanShortcuts({ onNewTask: () => useQuickCaptureStore.getState().open() });
  useHotkeys('Escape', () => { clearTodoSelection(); }, { enableOnFormTags: true });

  const filteredTodos = useKanbanFilters(todos, kanbanStatuses, kanbanFilters);
  const visibleTodos = kanbanFilters.showSubTasks
    ? filteredTodos
    : filteredTodos.filter((t) => !t.parent_id);

  const getEffectiveStatus = useCallback((todo: { id: string; status: string }): KanbanStatus => {
    if (kanbanStatuses[todo.id]) return kanbanStatuses[todo.id];
    return todo.status as KanbanStatus;
  }, [kanbanStatuses]);

  const todoTasks = useMemo(() => visibleTodos.filter((t) => getEffectiveStatus(t) === 'pending'), [visibleTodos, getEffectiveStatus]);
  const inProgressTasks = useMemo(() => visibleTodos.filter((t) => getEffectiveStatus(t) === 'in_progress'), [visibleTodos, getEffectiveStatus]);
  const doneTasks = useMemo(() => visibleTodos.filter((t) => getEffectiveStatus(t) === 'completed'), [visibleTodos, getEffectiveStatus]);

  const allTasksFlat = useMemo(
    () => [...todoTasks, ...inProgressTasks, ...doneTasks],
    [todoTasks, inProgressTasks, doneTasks],
  );

  const handleToggle = useCallback((id: string) => {
    const todo = todos.find((t) => t.id === id);
    if (todo) toggleMutation.mutate({ id, currentStatus: todo.status });
  }, [todos, toggleMutation]);

  const handleDelete = useCallback((id: string) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const { focusedTaskId, setFocusedTaskId } = useKanbanKeyboardNav({
    allTasksFlat,
    toggleTodoComplete: handleToggle,
    deleteTodo: handleDelete,
  });

  const handleSetKanbanStatus = useCallback((id: string, status: KanbanStatus) => {
    setKanbanStatusMutation.mutate({ id, status });
  }, [setKanbanStatusMutation]);

  const handleReorder = useCallback((todoId: string, newIndex: number, columnStatus: KanbanStatus) => {
    const getEffective = (t: { id: string; status: string }): KanbanStatus =>
      kanbanStatuses[t.id] ?? (t.status as KanbanStatus);
    const columnTodos = todos
      .filter((t) => getEffective(t) === columnStatus && !t.parent_id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const fromIdx = columnTodos.findIndex((t) => t.id === todoId);
    if (fromIdx < 0) return;
    const [moved] = columnTodos.splice(fromIdx, 1);
    columnTodos.splice(newIndex, 0, moved);
    const updates: Record<string, number> = {};
    columnTodos.forEach((t, i) => { updates[t.id] = i; });
    reorderMutation.mutate({ updates });
  }, [todos, kanbanStatuses, reorderMutation]);

  const { handleDragStart, handleDragEnd } = useKanbanDragDrop({
    setKanbanStatus: handleSetKanbanStatus,
    reorderTodoInColumn: handleReorder,
  });

  const handleClickTask = (id: string) => navigate(`/tasks/${id}`);
  const handleMove = (id: string, status: KanbanStatus) => handleSetKanbanStatus(id, status);

  const columnDefs = [
    { status: 'pending' as KanbanStatus, title: 'Todo', icon: <ClipboardIcon size={14} />, tasks: todoTasks },
    { status: 'in_progress' as KanbanStatus, title: 'In Progress', icon: <SpinArrowsIcon size={14} />, tasks: inProgressTasks },
    { status: 'completed' as KanbanStatus, title: 'Done', icon: <CheckCircleIcon size={14} />, tasks: doneTasks },
  ];

  return (
    <KanbanBoardView
      todos={todos}
      columnDefs={columnDefs}
      showSubTasks={kanbanFilters.showSubTasks}
      isMobile={isMobile}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onToggle={handleToggle}
      onClickTask={handleClickTask}
      onNewTask={() => useQuickCaptureStore.getState().open()}
      focusedTaskId={focusedTaskId}
      onFocusTask={setFocusedTaskId}
      selectedIds={selectedTodoIds}
      onSelect={toggleTodoSelection}
      isMultiSelectMode={isMultiSelectMode}
      onMove={handleMove}
      onDelete={handleDelete}
    />
  );
}
