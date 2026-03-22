/** Maps internal inbox states to user-facing display values */

export const INBOX_DISPLAY_LABELS: Record<string, string | null> = {
  classifying: 'Planning now',
  planning: 'Planning now',
  plan_ready: 'Review suggestion',
  captured: 'Needs organizing',
  error: 'Failed',
  none: null,
};

export const INBOX_DISPLAY_ACTIONS: Record<string, string | null> = {
  classifying: 'wait',
  planning: 'wait',
  plan_ready: 'review',
  captured: 'organize',
  error: 'retry',
  none: null,
};

export type InboxDisplaySection = 'planning_now' | 'review_suggestion' | 'needs_detail' | 'failed';

export function getInboxDisplayLabel(inboxState: string): string | null {
  return INBOX_DISPLAY_LABELS[inboxState] ?? null;
}

export function getInboxNextAction(inboxState: string, status = 'pending'): string | null {
  if (status === 'completed') return null;
  return INBOX_DISPLAY_ACTIONS[inboxState] ?? 'execute';
}

export function getInboxSection(inboxState: string): InboxDisplaySection | null {
  switch (inboxState) {
    case 'classifying':
    case 'planning':
      return 'planning_now';
    case 'plan_ready':
      return 'review_suggestion';
    case 'captured':
      return 'needs_detail';
    case 'error':
      return 'failed';
    default:
      return null;
  }
}

export function getInboxSectionLabel(section: InboxDisplaySection): string {
  switch (section) {
    case 'planning_now': return 'Planning now';
    case 'review_suggestion': return 'Review suggestion';
    case 'needs_detail': return 'Needs organizing';
    case 'failed': return 'Failed';
  }
}

export function getInboxCardAction(inboxState: string): { label: string; disabled: boolean } | null {
  switch (inboxState) {
    case 'classifying':
    case 'planning':
      return { label: 'Wait', disabled: true };
    case 'plan_ready':
      return { label: 'Review', disabled: false };
    case 'captured':
      return { label: 'Organize', disabled: false };
    case 'error':
      return { label: 'Retry', disabled: false };
    default:
      return null;
  }
}
