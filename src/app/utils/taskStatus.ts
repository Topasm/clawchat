import type { TaskStatus } from '../types/api';
import { translateUi } from '../i18n';

/** Completed and cancelled tasks no longer participate in active-work views. */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

export function getTaskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return translateUi('Todo');
    case 'in_progress':
      return translateUi('In Progress');
    case 'completed':
      return translateUi('Done');
    case 'cancelled':
      return translateUi('Cancelled');
  }
}
