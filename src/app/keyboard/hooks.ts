import { useHotkeys } from 'react-hotkeys-hook';
import { useLocation, useNavigate } from 'react-router-dom';
import { focusKanbanSearch } from '../components/kanban/KanbanFilterBar';
import { settingsNavigationState } from '../services/settingsNavigation';

interface KeyboardHookOptions {
  onToggleChat?: () => void;
  onShowHelp?: () => void;
  onNewTask?: () => void;
}

export function useGlobalShortcuts({ onToggleChat, onShowHelp }: KeyboardHookOptions) {
  useHotkeys(
    'ctrl+shift+c',
    (e) => {
      e.preventDefault();
      onToggleChat?.();
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    'shift+/',
    (e) => {
      // Only trigger on '?' when not in a text input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      e.preventDefault();
      onShowHelp?.();
    },
    { enableOnFormTags: false },
  );
}

export function useKanbanShortcuts({ onNewTask }: KeyboardHookOptions) {
  useHotkeys(
    'n',
    (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      e.preventDefault();
      onNewTask?.();
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    '/',
    (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      e.preventDefault();
      focusKanbanSearch();
    },
    { enableOnFormTags: false },
  );
}

export function useNavigationShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();

  useHotkeys('g+t', () => navigate('/today'), { enableOnFormTags: false });
  useHotkeys('g+i', () => navigate('/inbox'), { enableOnFormTags: false });
  useHotkeys('g+c', () => navigate('/chats'), { enableOnFormTags: false });
  useHotkeys('g+a', () => navigate('/tasks'), { enableOnFormTags: false });
  useHotkeys(
    'g+s',
    () =>
      navigate('/settings/app', {
        state: settingsNavigationState(location.pathname, location.search, location.state),
      }),
    { enableOnFormTags: false },
  );
}
