import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';
import { useChatStore } from '../../stores/useChatStore';
import { hapticMedium } from '../../utils/haptics';

interface FabAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

const TaskIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="12" height="12" rx="2" />
    <path d="M5 8l2 2 4-4" />
  </svg>
);

const EventIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="11" rx="2" />
    <path d="M5 1v4M11 1v4M2 7h12" />
  </svg>
);

const ChatIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" />
  </svg>
);

function getActions(pathname: string, navigate: ReturnType<typeof useNavigate>): FabAction[] {
  if (pathname === '/today') {
    return [
      {
        label: 'New Task',
        icon: <TaskIcon />,
        onClick: () => useQuickCaptureStore.getState().open({ placeholder: 'New task: e.g. "Buy groceries tomorrow"' }),
      },
      {
        label: 'New Event',
        icon: <EventIcon />,
        onClick: () => useQuickCaptureStore.getState().open({ placeholder: 'New event: e.g. "Meeting at 3pm"' }),
      },
    ];
  }

  if (pathname === '/inbox') {
    return [
      {
        label: 'New Task',
        icon: <TaskIcon />,
        onClick: () => useQuickCaptureStore.getState().open(),
      },
    ];
  }

  if (pathname === '/tasks') {
    return [
      {
        label: 'New Task',
        icon: <TaskIcon />,
        onClick: () => useQuickCaptureStore.getState().open(),
      },
    ];
  }

  if (pathname === '/chats') {
    return [
      {
        label: 'New Chat',
        icon: <ChatIcon />,
        onClick: async () => {
          try {
            const convo = await useChatStore.getState().createConversation();
            navigate(`/chats/${convo.id}`);
          } catch { /* stay on list page */ }
        },
      },
    ];
  }

  if (pathname === '/calendar') {
    return [
      {
        label: 'New Event',
        icon: <EventIcon />,
        onClick: () => useQuickCaptureStore.getState().open({ placeholder: 'New event: e.g. "Meeting at 3pm"' }),
      },
    ];
  }

  return [];
}

// Hide FAB on detail pages, settings, admin, search
const HIDDEN_PATTERNS = [
  /^\/(tasks|chats|events)\/[^/]+/,
  /^\/(settings|admin|search)/,
];

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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </>
  );
}
