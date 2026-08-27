import type { TaskStatus } from '../types/api';

/** Completed and cancelled tasks no longer participate in active-work views. */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

export function getTaskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return 'Todo';
    case 'in_progress':
      return 'In Progress';
    case 'completed':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
  }
}
