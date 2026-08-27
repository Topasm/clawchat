import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useTodosQuery } from '../../hooks/queries';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { CheckCircleIcon, MagnifyingGlassIcon, PinIcon, ThemeIcon } from './Icons';
import { ChatIcon, GearIcon, InboxIcon, SunIcon, TasksIcon } from './NavIcons';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { data: todos = [] } = useTodosQuery();
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
              <MagnifyingGlassIcon className="cc-cmd-palette__search-icon" size={14} />
              <Command.Input className="cc-cmd-palette__input" placeholder="Type a command or search…" />
            </div>
            <Command.List className="cc-cmd-palette__list">
              <Command.Empty className="cc-cmd-palette__empty">No results found.</Command.Empty>

              <Command.Group heading="Navigation" className="cc-cmd-palette__group">
                <Command.Item className="cc-cmd-palette__item" onSelect={() => go('/today')}>
                  <SunIcon className="cc-cmd-palette__item-icon" /> Today
                  <kbd className="cc-cmd-palette__kbd">G T</kbd>
                </Command.Item>
                <Command.Item className="cc-cmd-palette__item" onSelect={() => go('/inbox')}>
                  <InboxIcon className="cc-cmd-palette__item-icon" /> Inbox
                </Command.Item>
                <Command.Item className="cc-cmd-palette__item" onSelect={() => go('/chats')}>
                  <ChatIcon className="cc-cmd-palette__item-icon" /> Chats
                </Command.Item>
                <Command.Item className="cc-cmd-palette__item" onSelect={() => go('/tasks')}>
                  <TasksIcon className="cc-cmd-palette__item-icon" /> Tasks
                </Command.Item>
                <Command.Item className="cc-cmd-palette__item" onSelect={() => go('/settings')}>
                  <GearIcon className="cc-cmd-palette__item-icon" /> Settings
                </Command.Item>
              </Command.Group>

              <Command.Group heading="Actions" className="cc-cmd-palette__group">
                <Command.Item className="cc-cmd-palette__item" onSelect={toggleTheme}>
                  <ThemeIcon className="cc-cmd-palette__item-icon" /> Toggle Theme
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
                      {todo.status === 'completed'
                        ? <CheckCircleIcon className="cc-cmd-palette__item-icon" />
                        : <PinIcon className="cc-cmd-palette__item-icon" />}
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
