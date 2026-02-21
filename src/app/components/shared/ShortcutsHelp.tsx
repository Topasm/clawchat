import Dialog from './Dialog';
import { SHORTCUTS, type ShortcutScope } from '../../keyboard/registry';

interface ShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SCOPE_LABELS: Record<ShortcutScope, string> = {
  GLOBAL: 'Global',
  KANBAN: 'Kanban Board',
  TODAY: 'Today Page',
  CHAT: 'Chat',
  DIALOG: 'Dialogs',
};

const SCOPE_ORDER: ShortcutScope[] = ['GLOBAL', 'KANBAN', 'TODAY', 'CHAT', 'DIALOG'];

interface MergedShortcut {
  description: string;
  labels: string[];
}

function mergeShortcuts(shortcuts: typeof SHORTCUTS): MergedShortcut[] {
  const merged: MergedShortcut[] = [];
  for (const s of shortcuts) {
    const existing = merged.find((m) => m.description === s.description);
    if (existing) {
      existing.labels.push(s.label);
    } else {
      merged.push({ description: s.description, labels: [s.label] });
    }
  }
  return merged;
}

export default function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  const grouped = SCOPE_ORDER
    .map((scope) => ({
      scope,
      label: SCOPE_LABELS[scope],
      shortcuts: mergeShortcuts(SHORTCUTS.filter((s) => s.scope === scope)),
    }))
    .filter((g) => g.shortcuts.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard Shortcuts">
      <div className="cc-shortcuts-help">
        {grouped.map((group) => (
          <div key={group.scope} className="cc-shortcuts-help__group">
            <div className="cc-shortcuts-help__scope">{group.label}</div>
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.description} className="cc-shortcuts-help__row">
                <span className="cc-shortcuts-help__desc">{shortcut.description}</span>
                <span className="cc-shortcuts-help__keys">
                  {shortcut.labels.map((label, i) => (
                    <kbd key={label} className="cc-shortcuts-help__key">
                      {label}
                      {i < shortcut.labels.length - 1 ? '' : ''}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
