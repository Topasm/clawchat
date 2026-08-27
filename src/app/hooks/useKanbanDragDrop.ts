import { useCallback } from 'react';
import type { DropResult } from '@hello-pangea/dnd';
import { hapticLight } from '../utils/haptics';
import type { TaskStatus } from '../types/api';
import { TaskStatusSchema } from '../types/schemas';

const CARD_DROP_PREFIX = 'card-drop-';

interface UseKanbanDragDropOptions {
  setTaskStatus: (id: string, status: TaskStatus) => void;
  reorderTodoInColumn: (id: string, index: number, status: TaskStatus) => void;
  setParent: (childId: string, parentId: string) => void;
  clearParent: (childId: string) => void;
  getParentId: (todoId: string) => string | null | undefined;
  getChildIds: (todoId: string) => string[];
}

export default function useKanbanDragDrop({
  setTaskStatus,
  reorderTodoInColumn,
  setParent,
  clearParent,
  getParentId,
  getChildIds,
}: UseKanbanDragDropOptions) {
  const handleDragStart = useCallback(() => {
    hapticLight();
  }, []);

  const handleDragEnd = useCallback(
    (result: DropResult) => {
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
      const sourceStatus = TaskStatusSchema.safeParse(result.source.droppableId);
      const destinationStatus = TaskStatusSchema.safeParse(destDroppableId);
      if (!sourceStatus.success || !destinationStatus.success) return;
      const sourceCol: TaskStatus = sourceStatus.data;
      const destCol: TaskStatus = destinationStatus.data;

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
        setTaskStatus(taskId, destCol);
      }
    },
    [setTaskStatus, reorderTodoInColumn, setParent, clearParent, getParentId, getChildIds],
  );

  return { handleDragStart, handleDragEnd };
}
