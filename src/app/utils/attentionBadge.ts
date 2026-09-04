import type { TodoResponse } from '../types/api';
import { isInboxTodo, isTaskTodo } from './inboxState';

export interface AttentionBadgeCounts {
  inboxCount: number;
  dueCount: number;
  total: number;
}

/** Counts items that need attention for native app-icon badges. */
export function getAttentionBadgeCounts(
  todos: TodoResponse[],
  now: Date = new Date(),
): AttentionBadgeCounts {
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const inboxCount = todos.filter(isInboxTodo).length;
  const dueCount = todos.filter((todo) => {
    if (
      !isTaskTodo(todo) ||
      (todo.status !== 'pending' && todo.status !== 'in_progress') ||
      !todo.due_date
    ) {
      return false;
    }
    const due = new Date(todo.due_date);
    return !Number.isNaN(due.getTime()) && due <= endOfToday;
  }).length;
  return { inboxCount, dueCount, total: inboxCount + dueCount };
}
