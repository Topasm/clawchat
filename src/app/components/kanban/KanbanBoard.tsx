import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { useModuleStore } from '../../stores/useModuleStore';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import type { KanbanStatus, TodoResponse } from '../../types/api';
import KanbanColumn from './KanbanColumn';
import KanbanFilterBar from './KanbanFilterBar';
import QuickCaptureModal from '../shared/QuickCaptureModal';
import { useKanbanShortcuts } from '../../keyboard';

function isTextInput(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

export default function KanbanBoard() {
  const navigate = useNavigate();
  const [showCapture, setShowCapture] = useState(false);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const todos = useModuleStore((s) => s.todos);
  const kanbanStatuses = useModuleStore((s) => s.kanbanStatuses);
  const kanbanFilters = useModuleStore((s) => s.kanbanFilters);
  const setKanbanStatus = useModuleStore((s) => s.setKanbanStatus);
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);
  const deleteTodo = useModuleStore((s) => s.deleteTodo);

  useKanbanShortcuts({ onNewTask: () => setShowCapture(true) });

  useEffect(() => {
    useModuleStore.getState().fetchTodos().catch(() => {});
  }, []);

  const filteredTodos = useKanbanFilters(todos, kanbanStatuses, kanbanFilters);

  const getEffectiveStatus = useCallback((todo: { id: string; status: string }): KanbanStatus => {
    if (kanbanStatuses[todo.id]) return kanbanStatuses[todo.id];
    return todo.status as KanbanStatus;
  }, [kanbanStatuses]);

  const todoTasks = filteredTodos.filter((t) => getEffectiveStatus(t) === 'pending');
  const inProgressTasks = filteredTodos.filter((t) => getEffectiveStatus(t) === 'in_progress');
  const doneTasks = filteredTodos.filter((t) => getEffectiveStatus(t) === 'completed');

  const allTasksFlat: TodoResponse[] = useMemo(
    () => [...todoTasks, ...inProgressTasks, ...doneTasks],
    [todoTasks, inProgressTasks, doneTasks],
  );

  const focusedIndex = useMemo(
    () => allTasksFlat.findIndex((t) => t.id === focusedTaskId),
    [allTasksFlat, focusedTaskId],
  );

  useHotkeys('down', (e) => {
    if (isTextInput(e)) return;
    e.preventDefault();
    if (allTasksFlat.length === 0) return;
    const next = focusedIndex < 0 ? 0 : Math.min(focusedIndex + 1, allTasksFlat.length - 1);
    setFocusedTaskId(allTasksFlat[next].id);
  }, { enableOnFormTags: false });

  useHotkeys('up', (e) => {
    if (isTextInput(e)) return;
    e.preventDefault();
    if (allTasksFlat.length === 0) return;
    const prev = focusedIndex <= 0 ? 0 : focusedIndex - 1;
    setFocusedTaskId(allTasksFlat[prev].id);
  }, { enableOnFormTags: false });

  useHotkeys('d', (e) => {
    if (isTextInput(e)) return;
    if (!focusedTaskId) return;
    e.preventDefault();
    toggleTodoComplete(focusedTaskId);
  }, { enableOnFormTags: false });

  useHotkeys('e', (e) => {
    if (isTextInput(e)) return;
    if (!focusedTaskId) return;
    e.preventDefault();
    navigate(`/tasks/${focusedTaskId}`);
  }, { enableOnFormTags: false });

  useHotkeys('Delete,Backspace', (e) => {
    if (isTextInput(e)) return;
    if (!focusedTaskId) return;
    e.preventDefault();
    const idx = focusedIndex;
    deleteTodo(focusedTaskId);
    const remaining = allTasksFlat.filter((t) => t.id !== focusedTaskId);
    if (remaining.length > 0) {
      const nextIdx = Math.min(idx, remaining.length - 1);
      setFocusedTaskId(remaining[nextIdx].id);
    } else {
      setFocusedTaskId(null);
    }
  }, { enableOnFormTags: false });

  useEffect(() => {
    if (focusedTaskId && !allTasksFlat.find((t) => t.id === focusedTaskId)) {
      setFocusedTaskId(null);
    }
  }, [allTasksFlat, focusedTaskId]);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const taskId = result.draggableId;
    const newStatus = result.destination.droppableId as KanbanStatus;
    setKanbanStatus(taskId, newStatus);
  };

  const handleToggle = (id: string) => {
    toggleTodoComplete(id);
  };

  const handleClickTask = (id: string) => {
    navigate(`/tasks/${id}`);
  };

  return (
    <div>
      <div className="cc-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="cc-page-header__title">All Tasks</div>
          <div className="cc-page-header__subtitle">
            {todos.length} total task{todos.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button className="cc-btn cc-btn--primary" onClick={() => setShowCapture(true)}>
          + New Task
        </button>
      </div>
      <QuickCaptureModal isOpen={showCapture} onClose={() => setShowCapture(false)} />
      <KanbanFilterBar />
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="cc-kanban">
          <KanbanColumn
            status="pending"
            title="Todo"
            icon="\uD83D\uDCCB"
            tasks={todoTasks}
            onToggle={handleToggle}
            onClickTask={handleClickTask}
            focusedTaskId={focusedTaskId}
            onFocusTask={setFocusedTaskId}
          />
          <KanbanColumn
            status="in_progress"
            title="In Progress"
            icon="\uD83D\uDD04"
            tasks={inProgressTasks}
            onToggle={handleToggle}
            onClickTask={handleClickTask}
            focusedTaskId={focusedTaskId}
            onFocusTask={setFocusedTaskId}
          />
          <KanbanColumn
            status="completed"
            title="Done"
            icon="\u2705"
            tasks={doneTasks}
            onToggle={handleToggle}
            onClickTask={handleClickTask}
            focusedTaskId={focusedTaskId}
            onFocusTask={setFocusedTaskId}
          />
        </div>
      </DragDropContext>
    </div>
  );
}
