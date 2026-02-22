import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import axios from 'axios';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useTheme } from '../config/ThemeContext';
import { useModuleStore } from '../stores/useModuleStore';
import { useChatStore } from '../stores/useChatStore';
import ChatPanel from './chat-panel/ChatPanel';
import ErrorBoundary from './shared/ErrorBoundary';
import useChatPanel from '../hooks/useChatPanel';
import usePlatform from '../hooks/usePlatform';
import useDataSync from '../hooks/useDataSync';
import useWebSocket from '../hooks/useWebSocket';
import { useAuthStore } from '../stores/useAuthStore';
import type { ConnectionStatus } from '../stores/useAuthStore';
import AnimatedOutlet from './AnimatedOutlet';
import ToastContainer from './shared/ToastContainer';
import CommandPalette from './shared/CommandPalette';
import ShortcutsHelp from './shared/ShortcutsHelp';
import useCommandPalette from '../hooks/useCommandPalette';
import { useGlobalShortcuts, useNavigationShortcuts } from '../keyboard';
import type { ColorPalette } from '../config/theme';
import type { HealthResponse } from '../types/api';

// --- SVG icon components ---
import {
  SunIcon, InboxIcon, ChatIcon, NavCalendarIcon,
  TasksIcon, GearIcon, NavMemoIcon, SearchIcon, AdminIcon,
} from './shared/NavIcons';
import BottomNav from './shared/BottomNav';

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

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  demo: 'Demo Mode',
  connected: 'Connected',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting...',
};

const navItems = [
  { to: '/today', label: 'Today', Icon: SunIcon },
  { to: '/inbox', label: 'Inbox', Icon: InboxIcon },
  { to: '/chats', label: 'Chats', Icon: ChatIcon },
  { to: '/calendar', label: 'Calendar', Icon: NavCalendarIcon },
  { to: '/tasks', label: 'All Tasks', Icon: TasksIcon },
  { to: '/memos', label: 'Memos', Icon: NavMemoIcon },
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/settings', label: 'Settings', Icon: GearIcon },
  { to: '/admin', label: 'Admin', Icon: AdminIcon },
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

  // Health check polling
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);

  useEffect(() => {
    if (!serverUrl) {
      setHealthData(null);
      return;
    }
    let cancelled = false;
    const fetchHealth = async () => {
      try {
        const res = await axios.get(`${serverUrl}/api/health`);
        if (!cancelled) setHealthData(res.data);
      } catch {
        if (!cancelled) setHealthData(null);
      }
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [serverUrl]);

  // WebSocket connection for real-time updates
  useWebSocket();

  // Wire global keyboard shortcuts
  useGlobalShortcuts({
    onToggleChat: chatPanel.toggle,
    onShowHelp: () => setShowShortcuts(true),
  });
  useNavigationShortcuts();

  const connectionStatus = useAuthStore((s) => s.connectionStatus);

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
      <div className={`cc-connection-status cc-connection-status--${connectionStatus}`}>
        <span className="cc-connection-status__dot" />
        {CONNECTION_LABELS[connectionStatus]}
      </div>
      {healthData && (
        <div className={`cc-health-status cc-health-status--${healthData.ai_connected ? 'ok' : 'degraded'}`}>
          <span className="cc-health-status__dot" />
          AI: {healthData.ai_connected ? healthData.ai_model : 'Offline'}
        </div>
      )}
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
        <ErrorBoundary name="PageContent">
          <AnimatedOutlet />
        </ErrorBoundary>
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
          <div className="cc-main">{mainContent}</div>
          <BottomNav />
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
