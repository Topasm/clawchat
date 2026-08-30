import type { CSSProperties } from 'react';
import type { ColorPalette } from './theme';

export function themeCssVars(colors: ColorPalette, fontSize = 16): CSSProperties {
  return {
    '--cc-background': colors.background,
    '--cc-surface': colors.surface,
    '--cc-surface-secondary': colors.surfaceSecondary,
    '--cc-text': colors.text,
    '--cc-text-secondary': colors.textSecondary,
    '--cc-text-tertiary': colors.textTertiary,
    '--cc-border': colors.border,
    '--cc-disabled': colors.disabled,
    '--cc-primary': colors.primary,
    '--cc-primary-light': colors.primaryLight,
    '--cc-primary-dark': colors.primaryDark,
    '--cc-secondary': colors.secondary,
    '--cc-success': colors.success,
    '--cc-warning': colors.warning,
    '--cc-error': colors.error,
    '--cc-assistant-bubble': colors.assistantBubble,
    '--cc-user-bubble': colors.userBubble,
    '--cc-streaming': colors.streaming,
    '--cc-action-card': colors.actionCard,
    '--cc-today-blue': colors.todayBlue,
    '--cc-inbox-yellow': colors.inboxYellow,
    '--cc-completed-green': colors.completedGreen,
    '--cc-overdue-red': colors.overdueRed,
    '--cc-priority-urgent': colors.priorityUrgent,
    '--cc-priority-high': colors.priorityHigh,
    '--cc-priority-medium': colors.priorityMedium,
    '--cc-priority-low': colors.priorityLow,
    '--cc-shadow': colors.shadow,
    '--cc-delete-bg': colors.deleteBackground,
    '--cc-meta-tag-bg': colors.metaTagBackground,
    '--cc-font-size': `${fontSize}px`,
  } as CSSProperties;
}
