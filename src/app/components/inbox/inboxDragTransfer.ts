export const INBOX_TASK_DRAG_TYPE = 'application/x-clawchat-task-id';
export const INBOX_TASK_BATCH_DRAG_TYPE = 'application/x-clawchat-task-batch';
export const INBOX_DEPENDENCY_DRAG_TYPE = 'application/x-clawchat-task-dependency';

export function transferHasType(event: React.DragEvent, type: string): boolean {
  return (
    Array.from(event.dataTransfer.types ?? []).includes(type) ||
    Boolean(event.dataTransfer.getData(type))
  );
}

/** The batch payload of a drag, or an empty list when it carries no usable batch. */
export function transferredBatchTaskIds(event: React.DragEvent): string[] {
  const value = event.dataTransfer.getData(INBOX_TASK_BATCH_DRAG_TYPE);
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((taskId) => typeof taskId === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function draggedTaskId(event: React.DragEvent): string | null {
  return event.dataTransfer.getData(INBOX_TASK_DRAG_TYPE) || null;
}

/** The tasks a placement drop should move: the batch payload, else the single dragged task. */
export function draggedPlacementTaskIds(event: React.DragEvent): string[] {
  const batch = event.dataTransfer.getData(INBOX_TASK_BATCH_DRAG_TYPE);
  if (batch) {
    try {
      const parsed: unknown = JSON.parse(batch);
      if (Array.isArray(parsed) && parsed.every((taskId) => typeof taskId === 'string')) {
        return parsed;
      }
    } catch {
      return [];
    }
  }
  const taskId = draggedTaskId(event);
  return taskId ? [taskId] : [];
}

export function acceptsPlacementDrag(event: React.DragEvent): boolean {
  return (
    transferHasType(event, INBOX_TASK_DRAG_TYPE) ||
    transferHasType(event, INBOX_TASK_BATCH_DRAG_TYPE)
  );
}

export function draggedDependencyTaskId(event: React.DragEvent): string | null {
  return event.dataTransfer.getData(INBOX_DEPENDENCY_DRAG_TYPE) || null;
}
