import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';
import apiClient from '../../services/apiClient';
import { queryClient } from '../../config/queryClient';
import { queryKeys } from '../../hooks/queries/queryKeys';
import { hapticMedium } from '../../utils/haptics';
import type { ConversationResponse } from '../../types/api';
import { CalendarIcon, ChatBubbleIcon, CheckCircleIcon, PlusIcon } from './Icons';

interface FabAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function getActions(pathname: string, navigate: ReturnType<typeof useNavigate>): FabAction[] {
  if (pathname === '/today') {
    return [
      {
        label: 'New Task',
        icon: <CheckCircleIcon size={16} />,
        onClick: () =>
          useQuickCaptureStore
            .getState()
            .open({ placeholder: 'New task: e.g. "Buy groceries tomorrow"' }),
      },
      {
        label: 'New Event',
        icon: <CalendarIcon size={16} />,
        onClick: () =>
          useQuickCaptureStore.getState().open({ placeholder: 'New event: e.g. "Meeting at 3pm"' }),
      },
    ];
  }

  if (pathname === '/inbox') {
    return [
      {
        label: 'New Task',
        icon: <CheckCircleIcon size={16} />,
        onClick: () => useQuickCaptureStore.getState().open(),
      },
    ];
  }

  if (pathname === '/tasks') {
    return [
      {
        label: 'New Task',
        icon: <CheckCircleIcon size={16} />,
        onClick: () => useQuickCaptureStore.getState().open(),
      },
    ];
  }

  if (pathname === '/chats') {
    return [
      {
        label: 'New Chat',
        icon: <ChatBubbleIcon size={16} />,
        onClick: async () => {
          try {
            const res = await apiClient.post('/chat/conversations', { title: 'New Conversation' });
            const convo = res.data as ConversationResponse;
            queryClient.setQueryData<ConversationResponse[]>(queryKeys.conversations, (old) => [
              convo,
              ...(old ?? []),
            ]);
            navigate(`/chats/${convo.id}`);
          } catch {
            /* stay on list page */
          }
        },
      },
    ];
  }

  if (pathname === '/calendar') {
    return [
      {
        label: 'New Event',
        icon: <CalendarIcon size={16} />,
        onClick: () =>
          useQuickCaptureStore.getState().open({ placeholder: 'New event: e.g. "Meeting at 3pm"' }),
      },
    ];
  }

  return [];
}

// Hide FAB on detail pages, settings, admin, search
const HIDDEN_PATTERNS = [/^\/(tasks|chats|events)\/[^/]+/, /^\/(settings|admin|search)/];

export default function FloatingActionButton() {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const hidden = HIDDEN_PATTERNS.some((p) => p.test(location.pathname));
  const actions = getActions(location.pathname, navigate);

  if (hidden || actions.length === 0) return null;

  const handleAction = (action: FabAction) => {
    hapticMedium();
    setExpanded(false);
    action.onClick();
  };

  return (
    <>
      <AnimatePresence>
        {expanded && (
          <motion.div
            className="cc-fab__backdrop"
            onClick={() => setExpanded(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
        )}
      </AnimatePresence>
      <div className="cc-fab">
        <AnimatePresence>
          {expanded && (
            <div className="cc-fab__actions">
              {actions.map((action, i) => (
                <motion.button
                  key={action.label}
                  type="button"
                  className="cc-fab__action"
                  onClick={() => handleAction(action)}
                  initial={{ opacity: 0, y: 12, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.9 }}
                  transition={{ duration: 0.15, delay: i * 0.04 }}
                >
                  {action.icon}
                  {action.label}
                </motion.button>
              ))}
            </div>
          )}
        </AnimatePresence>
        <button
          type="button"
          className={`cc-fab__button${expanded ? ' cc-fab__button--open' : ''}`}
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Close actions' : 'Quick actions'}
        >
          <PlusIcon size={24} />
        </button>
      </div>
    </>
  );
}
