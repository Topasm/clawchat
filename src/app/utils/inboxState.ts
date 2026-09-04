import type { TodoResponse } from '../types/api';
import { isTerminalTaskStatus } from './taskStatus';

/**
 * Whether a task still belongs to the capture/triage workflow.
 *
 * Modern servers always send inbox_state. Older servers omitted the field, so
 * keep the old unfiled-task heuristic only for that missing-field case. An
 * explicit `none` means the user has organised the task, even when it has no
 * project or due date.
 */
export function isInboxTodo(todo: TodoResponse): boolean {
  if (isTerminalTaskStatus(todo.status)) return false;
  if (todo.inbox_state !== undefined) return todo.inbox_state !== 'none';

  return !todo.project_id && !todo.due_date && !todo.parent_id;
}

/** Tasks shown on execution surfaces. Terminal Inbox captures remain visible in history. */
export function isTaskTodo(todo: TodoResponse): boolean {
  return !isInboxTodo(todo);
}
