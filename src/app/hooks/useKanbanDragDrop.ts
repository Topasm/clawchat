import { useCallback } from 'react';
import type { DropResult } from '@hello-pangea/dnd';
import { hapticLight } from '../utils/haptics';
import type { KanbanStatus } from '../types/api';

interface UseKanbanDragDropOptions {
  setKanbanStatus: (id: string, status: KanbanStatus) => void;
  reorderTodoInColumn: (id: string, index: number, status: KanbanStatus) => void;
}

export default function useKanbanDragDrop({
  setKanbanStatus,
  reorderTodoInColumn,
}: UseKanbanDragDropOptions) {
  const handleDragStart = useCallback(() => {
    hapticLight();
  }, []);

  const handleDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    const taskId = result.draggableId;
    const sourceCol = result.source.droppableId as KanbanStatus;
    const destCol = result.destination.droppableId as KanbanStatus;
    if (sourceCol === destCol) {
      // Same column -> reorder
      reorderTodoInColumn(taskId, result.destination.index, destCol);
    } else {
      // Cross-column -> status change
      setKanbanStatus(taskId, destCol);
    }
  }, [setKanbanStatus, reorderTodoInColumn]);

  return { handleDragStart, handleDragEnd };
}
