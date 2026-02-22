export type ShortcutScope = 'GLOBAL' | 'KANBAN' | 'DIALOG' | 'CHAT' | 'TODAY';

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

  // Kanban
  { key: 'n', label: 'N', scope: 'KANBAN', description: 'New task' },
  { key: '/', label: '/', scope: 'KANBAN', description: 'Focus search' },
  { key: 'd', label: 'D', scope: 'KANBAN', description: 'Toggle focused task done' },
  { key: 'e', label: 'E', scope: 'KANBAN', description: 'Edit focused task' },
  { key: 'Delete', label: 'Del', scope: 'KANBAN', description: 'Delete focused task' },
  { key: 'Backspace', label: 'Backspace', scope: 'KANBAN', description: 'Delete focused task' },
  { key: 'ArrowUp', label: '\u2191', scope: 'KANBAN', description: 'Focus previous task' },
  { key: 'ArrowDown', label: '\u2193', scope: 'KANBAN', description: 'Focus next task' },

  // Today
  { key: 't', label: 'T', scope: 'TODAY', description: 'New task' },
  { key: 'e', label: 'E', scope: 'TODAY', description: 'New event' },
  { key: 'n', label: 'N', scope: 'TODAY', description: 'New memo' },

  // Chat
  { key: 'mod+Enter', label: 'Ctrl+Enter', scope: 'CHAT', description: 'Send message' },

  // Dialog
  { key: 'Escape', label: 'Esc', scope: 'DIALOG', description: 'Close dialog / palette' },
];
