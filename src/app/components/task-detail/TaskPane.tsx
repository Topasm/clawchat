import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { translateUi } from '../../i18n';
import { useToastStore } from '../../stores/useToastStore';
import ChatPanel from '../chat-panel/ChatPanel';
import { CloseIcon } from '../shared/Icons';
import TaskDetail from './TaskDetail';
import TaskMoreMenu, { type TaskMenuItem } from './TaskMoreMenu';

export type TaskPaneMode = 'task' | 'chat';

interface TaskPaneProps {
  taskId: string;
  mode: TaskPaneMode;
  onModeChange: (mode: TaskPaneMode) => void;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
  /** The AI segment: the same conversation the chat panel would show. */
  chat: {
    conversationId: string | null;
    onSetConversationId: (id: string | null) => void;
    title: string;
    subtitle?: string;
  };
}

/** Printed beside "AI": the key that opens the conversation from anywhere. */
const CHAT_SHORTCUT = /Mac|iPhone|iPad/.test(
  typeof navigator === 'undefined' ? '' : navigator.platform,
)
  ? '⌘K'
  : 'Ctrl+K';

/**
 * The right-hand pane on desktop: the task picked from a list, or the AI
 * conversation about it, behind one header. Escape closes it.
 */
export default function TaskPane({
  taskId,
  mode,
  onModeChange,
  onOpenTask,
  onClose,
  chat,
}: TaskPaneProps) {
  const navigate = useNavigate();
  // In task mode the task's own ⋮ renders here, with the pane's entries first.
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A dialog, the palette or an open menu owns Escape while it is up.
      if (document.querySelector('[role="dialog"], [cmdk-root], .cc-detail-pane [role="menu"]'))
        return;
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const chatMenuItems: TaskMenuItem[] = [
    {
      label: translateUi('Open full chat view'),
      onSelect: () => navigate(chat.conversationId ? `/chats/${chat.conversationId}` : '/projects'),
    },
  ];
  const taskMenuItems: TaskMenuItem[] = [
    { label: translateUi('Open as page'), onSelect: () => navigate(`/tasks/${taskId}`) },
    {
      label: translateUi('Copy link'),
      onSelect: () => {
        navigator.clipboard
          .writeText(`${window.location.origin}/tasks/${taskId}`)
          .then(() => useToastStore.getState().addToast('info', translateUi('Link copied')))
          .catch(() => useToastStore.getState().addToast('error', translateUi('Failed')));
      },
    },
  ];

  return (
    <aside className="cc-detail-pane" aria-label={translateUi('Task pane')}>
      <div className="cc-detail-pane__header">
        <div
          className="cc-detail-pane__segments"
          role="tablist"
          aria-label={translateUi('Pane view')}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'task'}
            className={`cc-detail-pane__segment${mode === 'task' ? ' cc-detail-pane__segment--active' : ''}`}
            onClick={() => onModeChange('task')}
          >
            {translateUi('Task')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'chat'}
            className={`cc-detail-pane__segment${mode === 'chat' ? ' cc-detail-pane__segment--active' : ''}`}
            onClick={() => onModeChange('chat')}
          >
            {translateUi('AI')}
            <kbd className="cc-detail-pane__kbd">{CHAT_SHORTCUT}</kbd>
          </button>
        </div>
        {mode === 'chat' ? <TaskMoreMenu items={chatMenuItems} /> : <span ref={setMenuSlot} />}
        <button
          type="button"
          className="cc-detail-pane__btn"
          aria-label={translateUi('Close pane')}
          title={translateUi('Close')}
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="cc-detail-pane__body" role="tabpanel">
        {mode === 'task' ? (
          <TaskDetail
            key={taskId}
            taskId={taskId}
            onOpenTask={onOpenTask}
            onDeleted={onClose}
            menuSlot={menuSlot}
            extraMenuItems={taskMenuItems}
          />
        ) : (
          <ChatPanel
            isOpen
            variant="side"
            hideHeader
            conversationId={chat.conversationId}
            onToggle={() => onModeChange('task')}
            onSetConversationId={chat.onSetConversationId}
            title={chat.title}
            subtitle={chat.subtitle}
          />
        )}
      </div>
    </aside>
  );
}
