export type ShortcutScope = 'GLOBAL' | 'KANBAN' | 'DIALOG' | 'CHAT';

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

  // Dialog
  { key: 'Escape', label: 'Esc', scope: 'DIALOG', description: 'Close dialog / palette' },
];

export function getShortcutsByScope(scope: ShortcutScope): ShortcutDef[] {
  return SHORTCUTS.filter((s) => s.scope === scope);
}
