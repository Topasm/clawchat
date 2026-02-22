import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import { isTextInput } from '../utils/helpers';
import type { TodoResponse } from '../types/api';

interface UseKanbanKeyboardNavOptions {
  allTasksFlat: TodoResponse[];
  toggleTodoComplete: (id: string) => void;
  deleteTodo: (id: string) => void;
}

export default function useKanbanKeyboardNav({
  allTasksFlat,
  toggleTodoComplete,
  deleteTodo,
}: UseKanbanKeyboardNavOptions) {
  const navigate = useNavigate();
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);

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

  return { focusedTaskId, setFocusedTaskId };
}
