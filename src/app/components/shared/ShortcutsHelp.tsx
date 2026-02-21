import Dialog from './Dialog';
import { SHORTCUTS, type ShortcutScope } from '../../keyboard/registry';

interface ShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SCOPE_LABELS: Record<ShortcutScope, string> = {
  GLOBAL: 'Global',
  KANBAN: 'Kanban Board',
  DIALOG: 'Dialogs',
  CHAT: 'Chat',
};

const SCOPE_ORDER: ShortcutScope[] = ['GLOBAL', 'KANBAN', 'DIALOG', 'CHAT'];

export default function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  const grouped = SCOPE_ORDER
    .map((scope) => ({
      scope,
      label: SCOPE_LABELS[scope],
      shortcuts: SHORTCUTS.filter((s) => s.scope === scope),
    }))
    .filter((g) => g.shortcuts.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard Shortcuts">
      <div className="cc-shortcuts-help">
        {grouped.map((group) => (
          <div key={group.scope} className="cc-shortcuts-help__group">
            <div className="cc-shortcuts-help__scope">{group.label}</div>
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.key} className="cc-shortcuts-help__row">
                <span className="cc-shortcuts-help__desc">{shortcut.description}</span>
                <kbd className="cc-shortcuts-help__key">{shortcut.label}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
