import { useCallback } from 'react';
import type { DropResult } from '@hello-pangea/dnd';
import { hapticLight } from '../utils/haptics';
import { taskStatusForColumn, type TasksColumnStatus } from '../utils/taskStatus';

const CARD_DROP_PREFIX = 'card-drop-';

interface UseKanbanDragDropOptions {
  setTaskStatus: (id: string, status: ReturnType<typeof taskStatusForColumn>) => void;
  reorderTodoInColumn: (id: string, index: number, column: TasksColumnStatus) => void;
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
      const columns: TasksColumnStatus[] = ['active', 'completed', 'cancelled'];
      if (
        !columns.includes(result.source.droppableId as TasksColumnStatus) ||
        !columns.includes(destDroppableId as TasksColumnStatus)
      ) {
        return;
      }
      const sourceCol = result.source.droppableId as TasksColumnStatus;
      const destCol = destDroppableId as TasksColumnStatus;

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
        setTaskStatus(taskId, taskStatusForColumn(destCol));
      }
    },
    [setTaskStatus, reorderTodoInColumn, setParent, clearParent, getParentId, getChildIds],
  );

  return { handleDragStart, handleDragEnd };
}
