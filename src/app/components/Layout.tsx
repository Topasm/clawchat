import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useTheme } from '../config/ThemeContext';
import { useModuleStore } from '../stores/useModuleStore';
import { useChatStore } from '../stores/useChatStore';
import ChatPanel from './chat-panel/ChatPanel';
import useChatPanel from '../hooks/useChatPanel';
import usePlatform from '../hooks/usePlatform';
import useDataSync from '../hooks/useDataSync';
import ToastContainer from './shared/ToastContainer';
import CommandPalette from './shared/CommandPalette';
import ShortcutsHelp from './shared/ShortcutsHelp';
import useCommandPalette from '../hooks/useCommandPalette';
import { useGlobalShortcuts, useNavigationShortcuts } from '../keyboard';
import type { ColorPalette } from '../config/theme';

// --- SVG icon components ---
function SunIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="3.5" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" strokeLinecap="round" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 10h4l1 2h3l1-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.1 4.5L2.5 10v4a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-4l-1.6-5.5A1.5 1.5 0 0012.5 3h-7a1.5 1.5 0 00-1.4 1.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M16 12a1.5 1.5 0 01-1.5 1.5H5L2 16.5V4A1.5 1.5 0 013.5 2.5h11A1.5 1.5 0 0116 4z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4.5h12M3 9h12M3 13.5h12" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="2.5" />
      <path d="M14.7 11.2a1.2 1.2 0 00.2 1.3l.04.04a1.44 1.44 0 11-2.04 2.04l-.04-.04a1.2 1.2 0 00-1.3-.2 1.2 1.2 0 00-.73 1.1v.12a1.44 1.44 0 11-2.88 0v-.06a1.2 1.2 0 00-.78-1.1 1.2 1.2 0 00-1.3.2l-.04.04a1.44 1.44 0 11-2.04-2.04l.04-.04a1.2 1.2 0 00.2-1.3 1.2 1.2 0 00-1.1-.73H3.45a1.44 1.44 0 110-2.88h.06a1.2 1.2 0 001.1-.78 1.2 1.2 0 00-.2-1.3l-.04-.04A1.44 1.44 0 116.41 3.43l.04.04a1.2 1.2 0 001.3.2h.06a1.2 1.2 0 00.73-1.1V2.45a1.44 1.44 0 012.88 0v.06a1.2 1.2 0 00.73 1.1 1.2 1.2 0 001.3-.2l.04-.04a1.44 1.44 0 112.04 2.04l-.04.04a1.2 1.2 0 00-.2 1.3v.06a1.2 1.2 0 001.1.73h.12a1.44 1.44 0 010 2.88h-.06a1.2 1.2 0 00-1.1.73z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MemoIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2.5H4a1.5 1.5 0 00-1.5 1.5v10a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5V4A1.5 1.5 0 0014 2.5z" />
      <path d="M6 6.5h6M6 9.5h6M6 12.5h3" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="cc-nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5" />
      <path d="M15.5 15.5l-3.6-3.6" strokeLinecap="round" />
    </svg>
  );
}

// --- Theme bridge: map ColorPalette → CSS custom properties ---
function cssVars(colors: ColorPalette): React.CSSProperties {
  return {
    '--cc-background': colors.background,
    '--cc-surface': colors.surface,
    '--cc-surface-secondary': colors.surfaceSecondary,
    '--cc-text': colors.text,
    '--cc-text-secondary': colors.textSecondary,
    '--cc-text-tertiary': colors.textTertiary,
    '--cc-border': colors.border,
    '--cc-disabled': colors.disabled,
    '--cc-primary': colors.primary,
    '--cc-primary-light': colors.primaryLight,
    '--cc-primary-dark': colors.primaryDark,
    '--cc-secondary': colors.secondary,
    '--cc-success': colors.success,
    '--cc-warning': colors.warning,
    '--cc-error': colors.error,
    '--cc-assistant-bubble': colors.assistantBubble,
    '--cc-user-bubble': colors.userBubble,
    '--cc-streaming': colors.streaming,
    '--cc-action-card': colors.actionCard,
    '--cc-today-blue': colors.todayBlue,
    '--cc-inbox-yellow': colors.inboxYellow,
    '--cc-completed-green': colors.completedGreen,
    '--cc-overdue-red': colors.overdueRed,
    '--cc-priority-urgent': colors.priorityUrgent,
    '--cc-priority-high': colors.priorityHigh,
    '--cc-priority-medium': colors.priorityMedium,
    '--cc-priority-low': colors.priorityLow,
    '--cc-shadow': colors.shadow,
    '--cc-delete-bg': colors.deleteBackground,
    '--cc-meta-tag-bg': colors.metaTagBackground,
  } as React.CSSProperties;
}

const navItems = [
  { to: '/today', label: 'Today', Icon: SunIcon },
  { to: '/inbox', label: 'Inbox', Icon: InboxIcon },
  { to: '/chats', label: 'Chats', Icon: ChatIcon },
  { to: '/tasks', label: 'All Tasks', Icon: TasksIcon },
  { to: '/memos', label: 'Memos', Icon: MemoIcon },
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/settings', label: 'Settings', Icon: GearIcon },
];

export default function Layout() {
  const { colors } = useTheme();
  const location = useLocation();
  const chatPanel = useChatPanel();
  const commandPalette = useCommandPalette();
  const { isMobile } = usePlatform();
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Central data sync: fetches all data from server on mount (no-op in demo mode)
  useDataSync();

  // Wire global keyboard shortcuts
  useGlobalShortcuts({
    onToggleChat: chatPanel.toggle,
    onShowHelp: () => setShowShortcuts(true),
  });
  useNavigationShortcuts();

  // Badge counts
  const inboxCount = useModuleStore((s) =>
    (s.todos ?? []).filter((t) => !t.due_date && t.status !== 'completed').length,
  );
  const chatCount = useChatStore((s) => (s.conversations ?? []).length);

  // Hide ChatPanel when on full ChatPage
  const onChatPage = location.pathname.startsWith('/chats/') && location.pathname !== '/chats';

  const sidebar = (
    <nav className="cc-sidebar">
      <div className="cc-sidebar__header">ClawChat</div>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `cc-nav-item${isActive ? ' cc-nav-item--active' : ''}`
          }
        >
          <item.Icon />
          {item.label}
          {item.to === '/inbox' && inboxCount > 0 && (
            <span className="cc-nav-badge">{inboxCount}</span>
          )}
          {item.to === '/chats' && chatCount > 0 && (
            <span className="cc-nav-badge">{chatCount}</span>
          )}
        </NavLink>
      ))}
      <div className="cc-sidebar__spacer" />
    </nav>
  );

  const mainContent = (
    <>
      <div className="cc-content">
        <Outlet />
      </div>
      {!onChatPage && (
        <ChatPanel
          isOpen={chatPanel.isOpen}
          conversationId={chatPanel.conversationId}
          onToggle={chatPanel.toggle}
          onSetConversationId={chatPanel.setConversationId}
        />
      )}
    </>
  );

  return (
    <div className="cc-root" style={cssVars(colors)}>
      <ToastContainer />
      <CommandPalette open={commandPalette.isOpen} onOpenChange={commandPalette.setIsOpen} />
      <ShortcutsHelp open={showShortcuts} onOpenChange={setShowShortcuts} />

      {isMobile ? (
        <>
          {sidebar}
          <div className="cc-main">{mainContent}</div>
        </>
      ) : (
        <PanelGroup orientation="horizontal" id="cc-layout-h">
          <Panel defaultSize={18} minSize={12} maxSize={30} id="sidebar" className="cc-sidebar-panel">
            {sidebar}
          </Panel>
          <PanelResizeHandle className="cc-resize-handle cc-resize-handle--vertical" />
          <Panel minSize={40} id="main-content">
            <div className="cc-main">{mainContent}</div>
          </Panel>
        </PanelGroup>
      )}
    </div>
  );
}
