import type { TaskStatus } from '../types/api';
import { translateUi } from '../i18n';

/** Completed and cancelled tasks no longer participate in active-work views. */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

export function getTaskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'pending':
    case 'in_progress':
      return translateUi('Active');
    case 'completed':
      return translateUi('Done');
    case 'cancelled':
      return translateUi('Cancelled');
  }
}

export type TasksStatusFilter = 'active' | 'completed' | 'all';
export type TasksColumnStatus = 'active' | 'completed' | 'cancelled';

export function matchesTasksStatusFilter(status: TaskStatus, filter: TasksStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return status === 'pending' || status === 'in_progress';
  return status === 'completed';
}

export function taskStatusForColumn(column: TasksColumnStatus): TaskStatus {
  return column === 'active' ? 'pending' : column;
}
