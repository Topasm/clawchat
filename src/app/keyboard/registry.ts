export type ShortcutScope = 'GLOBAL' | 'TASKS' | 'DIALOG' | 'CHAT' | 'TODAY';

export interface ShortcutDef {
  key: string;
  label: string;
  scope: ShortcutScope;
  description: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  // Global
  { key: 'mod+k', label: 'Ctrl+K', scope: 'GLOBAL', description: 'Open command palette' },
  { key: 'shift+/', label: '?', scope: 'GLOBAL', description: 'Show keyboard shortcuts' },
  { key: 'ctrl+shift+c', label: 'Ctrl+Shift+C', scope: 'GLOBAL', description: 'Toggle chat panel' },

  // Tasks
  { key: 'n', label: 'N', scope: 'TASKS', description: 'New task' },
  { key: '/', label: '/', scope: 'TASKS', description: 'Focus search' },

  // Today
  { key: 't', label: 'T', scope: 'TODAY', description: 'New task' },
  { key: 'e', label: 'E', scope: 'TODAY', description: 'New event' },

  // Chat
  { key: 'mod+Enter', label: 'Ctrl+Enter', scope: 'CHAT', description: 'Send message' },

  // Dialog
  { key: 'Escape', label: 'Esc', scope: 'DIALOG', description: 'Close dialog / palette' },
];
