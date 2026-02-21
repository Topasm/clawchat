import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useModuleStore } from '../../stores/useModuleStore';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const todos = useModuleStore((s) => s.todos);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const theme = useSettingsStore((s) => s.theme);

  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
    onOpenChange(false);
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="cc-dialog__overlay" />
        <RadixDialog.Content className="cc-cmd-palette" aria-label="Command palette">
          <Command className="cc-cmd-palette__inner" label="Command palette">
            <div className="cc-cmd-palette__input-wrap">
              <svg className="cc-cmd-palette__search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="6" cy="6" r="4.5" />
                <path d="M9.5 9.5L13 13" strokeLinecap="round" />
              </svg>
              <Command.Input className="cc-cmd-palette__input" placeholder="Type a command or search…" />
            </div>
            <Command.List className="cc-cmd-palette__list">
              <Command.Empty className="cc-cmd-palette__empty">No results found.</Command.Empty>

              <Command.Group heading="Navigation" className="cc-cmd-palette__group">
                <Command.Item className="cc-cmd-palette__item" onSelect={() => go('/today')}>
                  <span>☀️</span> Today
                  <kbd className="cc-cmd-palette__kbd">G T</kbd>
                </Command.Item>
                <Command.Item className="cc-cmd-palette__item" onSelect={() => go('/inbox')}>
                  <span>📥</span> Inbox
                </Command.Item>
                <Command.Item className="cc-cmd-palette__item" onSelect={() => go('/chats')}>
                  <span>💬</span> Chats
                </Command.Item>
                <Command.Item className="cc-cmd-palette__item" onSelect={() => go('/tasks')}>
                  <span>📋</span> All Tasks
                </Command.Item>
                <Command.Item className="cc-cmd-palette__item" onSelect={() => go('/settings')}>
                  <span>⚙️</span> Settings
                </Command.Item>
              </Command.Group>

              <Command.Group heading="Actions" className="cc-cmd-palette__group">
                <Command.Item className="cc-cmd-palette__item" onSelect={toggleTheme}>
                  <span>🌓</span> Toggle Theme
                </Command.Item>
              </Command.Group>

              {todos.length > 0 && (
                <Command.Group heading="Tasks" className="cc-cmd-palette__group">
                  {todos.slice(0, 10).map((todo) => (
                    <Command.Item
                      key={todo.id}
                      className="cc-cmd-palette__item"
                      value={todo.title}
                      onSelect={() => go(`/tasks/${todo.id}`)}
                    >
                      <span>{todo.status === 'completed' ? '✅' : '📌'}</span>
                      {todo.title}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
