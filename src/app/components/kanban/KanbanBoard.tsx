import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import { useModuleStore } from '../../stores/useModuleStore';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import usePlatform from '../../hooks/usePlatform';
import useKanbanKeyboardNav from '../../hooks/useKanbanKeyboardNav';
import useKanbanDragDrop from '../../hooks/useKanbanDragDrop';
import type { KanbanStatus } from '../../types/api';
import { useKanbanShortcuts } from '../../keyboard';
import KanbanBoardView from './KanbanBoardView';

export default function KanbanBoard() {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const [showCapture, setShowCapture] = useState(false);
  const todos = useModuleStore((s) => s.todos);
  const kanbanStatuses = useModuleStore((s) => s.kanbanStatuses);
  const kanbanFilters = useModuleStore((s) => s.kanbanFilters);
  const setKanbanStatus = useModuleStore((s) => s.setKanbanStatus);
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);
  const deleteTodo = useModuleStore((s) => s.deleteTodo);
  const selectedTodoIds = useModuleStore((s) => s.selectedTodoIds);
  const toggleTodoSelection = useModuleStore((s) => s.toggleTodoSelection);
  const clearTodoSelection = useModuleStore((s) => s.clearTodoSelection);
  const reorderTodoInColumn = useModuleStore((s) => s.reorderTodoInColumn);
  const isMultiSelectMode = selectedTodoIds.size > 0;

  useKanbanShortcuts({ onNewTask: () => setShowCapture(true) });
  useHotkeys('Escape', () => { clearTodoSelection(); }, { enableOnFormTags: true });

  const filteredTodos = useKanbanFilters(todos, kanbanStatuses, kanbanFilters);
  const visibleTodos = kanbanFilters.showSubTasks
    ? filteredTodos
    : filteredTodos.filter((t) => !t.parent_id);

  const getEffectiveStatus = useCallback((todo: { id: string; status: string }): KanbanStatus => {
    if (kanbanStatuses[todo.id]) return kanbanStatuses[todo.id];
    return todo.status as KanbanStatus;
  }, [kanbanStatuses]);

  const todoTasks = visibleTodos.filter((t) => getEffectiveStatus(t) === 'pending');
  const inProgressTasks = visibleTodos.filter((t) => getEffectiveStatus(t) === 'in_progress');
  const doneTasks = visibleTodos.filter((t) => getEffectiveStatus(t) === 'completed');

  const allTasksFlat = useMemo(
    () => [...todoTasks, ...inProgressTasks, ...doneTasks],
    [todoTasks, inProgressTasks, doneTasks],
  );

  const { focusedTaskId, setFocusedTaskId } = useKanbanKeyboardNav({
    allTasksFlat,
    toggleTodoComplete,
    deleteTodo,
  });

  const { handleDragStart, handleDragEnd } = useKanbanDragDrop({
    setKanbanStatus,
    reorderTodoInColumn,
  });

  const handleToggle = (id: string) => toggleTodoComplete(id);
  const handleClickTask = (id: string) => navigate(`/tasks/${id}`);
  const handleMove = (id: string, status: KanbanStatus) => setKanbanStatus(id, status);

  const columnDefs = [
    { status: 'pending' as KanbanStatus, title: 'Todo', icon: '\uD83D\uDCCB', tasks: todoTasks },
    { status: 'in_progress' as KanbanStatus, title: 'In Progress', icon: '\uD83D\uDD04', tasks: inProgressTasks },
    { status: 'completed' as KanbanStatus, title: 'Done', icon: '\u2705', tasks: doneTasks },
  ];

  return (
    <KanbanBoardView
      todos={todos}
      columnDefs={columnDefs}
      showSubTasks={kanbanFilters.showSubTasks}
      isMobile={isMobile}
      showCapture={showCapture}
      onCloseCapture={() => setShowCapture(false)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onToggle={handleToggle}
      onClickTask={handleClickTask}
      onNewTask={() => setShowCapture(true)}
      focusedTaskId={focusedTaskId}
      onFocusTask={setFocusedTaskId}
      selectedIds={selectedTodoIds}
      onSelect={toggleTodoSelection}
      isMultiSelectMode={isMultiSelectMode}
      onMove={handleMove}
    />
  );
}
