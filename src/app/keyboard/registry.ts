export type ShortcutScope = 'GLOBAL' | 'TASKS' | 'DIALOG' | 'CHAT' | 'TODAY';

export interface ShortcutDef {
  key: string;
  label: string;
  scope: ShortcutScope;
  description: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  // Global
  { key: 'mod+n', label: 'Ctrl+N', scope: 'GLOBAL', description: 'New item' },
  { key: 'mod+k', label: 'Ctrl+K', scope: 'GLOBAL', description: 'Talk with AI' },
  { key: 'mod+p', label: 'Ctrl+P', scope: 'GLOBAL', description: 'Open command palette' },
  { key: 'shift+/', label: '?', scope: 'GLOBAL', description: 'Show keyboard shortcuts' },

  // Tasks
  { key: 'n', label: 'N', scope: 'TASKS', description: 'New item' },
  { key: '/', label: '/', scope: 'TASKS', description: 'Focus search' },

  // Today
  { key: 't', label: 'T', scope: 'TODAY', description: 'New item' },

  // Chat
  { key: 'mod+Enter', label: 'Ctrl+Enter', scope: 'CHAT', description: 'Send message' },

  // Dialog
  { key: 'Escape', label: 'Esc', scope: 'DIALOG', description: 'Close dialog / palette' },
];
