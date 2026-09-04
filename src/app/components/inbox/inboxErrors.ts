import type { TodoResponse } from '../../types/api';

interface InboxErrorResponse {
  status?: number;
  data?: {
    error?: {
      message?: string;
      details?: { cycle_task_ids?: string[] };
    };
  };
}

function errorResponse(error: unknown): InboxErrorResponse | undefined {
  return (error as { response?: InboxErrorResponse }).response;
}

function errorStatus(error: unknown): number | undefined {
  return errorResponse(error)?.status;
}

export function isGraphRevisionConflict(error: unknown): boolean {
  return errorStatus(error) === 409;
}

/** The server's message for a failed Inbox command, or `fallback`. */
export function inboxErrorMessage(error: unknown, fallback: string): string {
  return errorResponse(error)?.data?.error?.message ?? fallback;
}

/** Undo failures distinguish a stale change set from every other failure. */
export function undoErrorMessage(error: unknown, fallback: string): string {
  const response = errorResponse(error);
  return (
    response?.data?.error?.message ??
    (response?.status === 409 ? 'Could not undo after later task changes' : fallback)
  );
}

/** Dependency failures name the cycle they would have created. */
export function dependencyErrorMessage(
  error: unknown,
  todoById: ReadonlyMap<string, TodoResponse>,
): string {
  const response = errorResponse(error);
  const cycleIds = response?.data?.error?.details?.cycle_task_ids;
  if (cycleIds?.length) {
    const path = cycleIds.map((id) => todoById.get(id)?.title ?? id).join(' → ');
    return `Cannot connect these tasks because it creates a cycle: ${path}`;
  }
  if (response?.status === 409) return 'The graph changed. Refreshing before you try again.';
  return response?.data?.error?.message ?? 'Could not validate this dependency';
}
