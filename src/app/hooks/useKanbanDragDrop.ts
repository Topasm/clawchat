import { useCallback } from 'react';
import type { DropResult } from '@hello-pangea/dnd';
import { hapticLight } from '../utils/haptics';
import type { KanbanStatus } from '../types/api';

const CARD_DROP_PREFIX = 'card-drop-';

interface UseKanbanDragDropOptions {
  setKanbanStatus: (id: string, status: KanbanStatus) => void;
  reorderTodoInColumn: (id: string, index: number, status: KanbanStatus) => void;
  setParent: (childId: string, parentId: string) => void;
  clearParent: (childId: string) => void;
  getParentId: (todoId: string) => string | null | undefined;
  getChildIds: (todoId: string) => string[];
}

export default function useKanbanDragDrop({
  setKanbanStatus,
  reorderTodoInColumn,
  setParent,
  clearParent,
  getParentId,
  getChildIds,
}: UseKanbanDragDropOptions) {
  const handleDragStart = useCallback(() => {
    hapticLight();
  }, []);

  const handleDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    const taskId = result.draggableId;
    const destDroppableId = result.destination.droppableId;

    // -- Dropped onto a card → assign as child (subtask) --
    if (destDroppableId.startsWith(CARD_DROP_PREFIX)) {
      const targetTodoId = destDroppableId.slice(CARD_DROP_PREFIX.length);

      // Prevent dropping on itself
      if (taskId === targetTodoId) return;

      // Prevent dropping on own children (would create a cycle)
      const children = getChildIds(taskId);
      if (children.includes(targetTodoId)) return;

      setParent(taskId, targetTodoId);
      return;
    }

    // -- Dropped into a column (existing reorder / status-change logic) --
    const sourceCol = result.source.droppableId as KanbanStatus;
    const destCol = destDroppableId as KanbanStatus;

    // If the dragged card has a parent_id, clear it (un-parent on column drop)
    const currentParent = getParentId(taskId);
    if (currentParent) {
      clearParent(taskId);
    }

    if (sourceCol === destCol) {
      // Same column -> reorder
      reorderTodoInColumn(taskId, result.destination.index, destCol);
    } else {
      // Cross-column -> status change
      setKanbanStatus(taskId, destCol);
    }
  }, [setKanbanStatus, reorderTodoInColumn, setParent, clearParent, getParentId, getChildIds]);

  return { handleDragStart, handleDragEnd };
}
