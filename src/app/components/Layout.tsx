import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import type { PanelSize } from 'react-resizable-panels';
import { useTheme } from '../config/ThemeContext';
import { useModuleStore } from '../stores/useModuleStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import apiClient from '../services/apiClient';
import ChatPanel from './chat-panel/ChatPanel';
import ErrorBoundary from './shared/ErrorBoundary';
import useChatPanel from '../hooks/useChatPanel';
import usePlatform from '../hooks/usePlatform';
import useDataSync from '../hooks/useDataSync';
import useWebSocket from '../hooks/useWebSocket';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { useAuthStore } from '../stores/useAuthStore';
import type { ConnectionStatus } from '../stores/useAuthStore';
import AnimatedOutlet from './AnimatedOutlet';
import ToastContainer from './shared/ToastContainer';
import CommandPalette from './shared/CommandPalette';
import ShortcutsHelp from './shared/ShortcutsHelp';
import QuickCaptureModal from './shared/QuickCaptureModal';
import OfflineIndicator from './shared/OfflineIndicator';
import FloatingActionButton from './shared/FloatingActionButton';
import PullToRefresh from './shared/PullToRefresh';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { useCapabilitiesQuery } from '../hooks/queries';
import { setAppBadge } from '../services/badgeService';
import useCommandPalette from '../hooks/useCommandPalette';
import { useGlobalShortcuts, useNavigationShortcuts } from '../keyboard';
import type { ColorPalette } from '../config/theme';
import type { HealthResponse } from '../types/api';

// --- SVG icon components ---
import {
  SunIcon, InboxIcon, ChatIcon,
  TasksIcon, GearIcon, SearchIcon, AdminIcon,
  NavCalendarIcon,
} from './shared/NavIcons';
import BottomNav, { mobileTabs } from './shared/BottomNav';
import UpdateNotification from './shared/UpdateNotification';

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
  connected: 'Connected',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting...',
};

const primaryNavItems = [
  { to: '/today', label: 'Today', Icon: SunIcon },
  { to: '/inbox', label: 'Inbox', Icon: InboxIcon },
  { to: '/chats', label: 'Projects', Icon: ChatIcon },
];

const secondaryNavItems = [
  { to: '/tasks', label: 'All Tasks', Icon: TasksIcon },
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/calendar', label: 'Calendar', Icon: NavCalendarIcon },
  { to: '/settings', label: 'Settings', Icon: GearIcon },
  { to: '/admin', label: 'Admin', Icon: AdminIcon },
];

// Flat list for backward compatibility (used in swipe navigation, etc.)
const navItems = [...primaryNavItems, ...secondaryNavItems];

export default function Layout() {
  const { colors } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const chatPanel = useChatPanel();
  const commandPalette = useCommandPalette();
  const { isMobile } = usePlatform();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const quickCapture = useQuickCaptureStore();
  const { data: capabilities } = useCapabilitiesQuery();

  // Conditionally filter nav items based on server capabilities
  const filteredPrimaryNavItems = useMemo(() => {
    if (!capabilities) return primaryNavItems;
    return primaryNavItems.filter((item) => {
      if (item.to === '/inbox' && !capabilities.features.inbox_pipeline) return false;
      return true;
    });
  }, [capabilities]);

  const filteredSecondaryNavItems = useMemo(() => {
    if (!capabilities) return secondaryNavItems;
    return secondaryNavItems.filter((item) => {
      // Hide obsidian-related items when obsidian is not configured
      // (Currently no dedicated obsidian nav item, but future-proof)
      return true;
    });
  }, [capabilities]);

  // Widget deep-link navigation
  useEffect(() => {
    const handler = ((e: CustomEvent<string>) => {
      if (e.detail) navigate(e.detail);
    }) as EventListener;
    window.addEventListener('navigate', handler);
    return () => window.removeEventListener('navigate', handler);
  }, [navigate]);

  // Electron: global shortcut opens quick capture (Cmd/Ctrl+Shift+Space)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.on) {
      const unsub = window.electronAPI.on('open-quick-capture', () => {
        quickCapture.open();
      });
      return () => unsub();
    }
  }, [quickCapture]);

  // Web: keyboard shortcut 'Q' opens quick capture (when no input is focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        quickCapture.open();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [quickCapture]);

  // Central data sync: fetches all data from server on mount (no-op in demo mode)
  const { refresh } = useDataSync();

  // Offline queue: monitor network status and flush on reconnect
  const { isFlushing, pendingCount } = useNetworkStatus(refresh);

  // Health check polling
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const setHealthOK = useAuthStore((s) => s.setHealthOK);
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);

  useEffect(() => {
    if (!serverUrl) {
      setHealthData(null);
      setHealthOK(true);
      return;
    }
    let cancelled = false;
    const fetchHealth = async () => {
      try {
        const res = await apiClient.get(`${serverUrl}/api/health`);
        if (!cancelled) {
          setHealthData(res.data);
          setHealthOK(true);
        }
      } catch {
        if (!cancelled) {
          setHealthData(null);
          setHealthOK(false);
        }
      }
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [serverUrl, setHealthOK]);

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
  // Sync inbox count to native app icon badge
  useEffect(() => {
    void setAppBadge(inboxCount);
  }, [inboxCount]);

  // Hide ChatPanel when on full ChatPage
  const onChatPage = location.pathname.startsWith('/chats/') && location.pathname !== '/chats';

  const activeMobileTabIndex = useMemo(() => (
    mobileTabs.findIndex((tab) => location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`))
  ), [location.pathname]);

  const canSwipeTabs = isMobile && !onChatPage && activeMobileTabIndex >= 0;
  const isDetailPage = isMobile && (/^\/(tasks|chats|events)\/[^/]+/.test(location.pathname)
    || location.pathname === '/settings/system-prompt');

  const sidebar = (
    <nav className={`cc-sidebar${sidebarCollapsed ? ' cc-sidebar--collapsed' : ''}`}>
      <div className="cc-sidebar__header">
        <span className="cc-sidebar__title">ClawChat</span>
        <button
          className="cc-sidebar-toggle"
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="cc-nav-icon">
            {sidebarCollapsed ? (
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      </div>
      <div className={`cc-connection-status cc-connection-status--${connectionStatus}`}>
        <span className="cc-connection-status__dot" />
        <span className="cc-sidebar__label">
          {isFlushing ? 'Syncing...' : CONNECTION_LABELS[connectionStatus]}
          {pendingCount > 0 && (
            <span className="cc-offline-badge" title={`${pendingCount} pending action${pendingCount > 1 ? 's' : ''}`}>
              {pendingCount}
            </span>
          )}
        </span>
      </div>
      {healthData && (
        <div className={`cc-health-status cc-health-status--${healthData.ai_connected ? 'ok' : 'degraded'}`}>
          <span className="cc-health-status__dot" />
          <span className="cc-sidebar__label">AI: {healthData.ai_connected ? healthData.ai_model : 'Offline'}</span>
        </div>
      )}
      {filteredPrimaryNavItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `cc-nav-item cc-nav-item--primary${isActive ? ' cc-nav-item--active' : ''}`
          }
          title={sidebarCollapsed ? item.label : undefined}
        >
          <item.Icon />
          <span className="cc-sidebar__label">{item.label}</span>
          {item.to === '/inbox' && inboxCount > 0 && (
            <span className="cc-nav-badge">{inboxCount}</span>
          )}
        </NavLink>
      ))}
      <div className="cc-sidebar__divider" />
      {filteredSecondaryNavItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `cc-nav-item${isActive ? ' cc-nav-item--active' : ''}`
          }
          title={sidebarCollapsed ? item.label : undefined}
        >
          <item.Icon />
          <span className="cc-sidebar__label">{item.label}</span>
        </NavLink>
      ))}
      <div className="cc-sidebar__spacer" />
    </nav>
  );

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!canSwipeTabs && !isDetailPage) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, button, [role="button"], [contenteditable="true"], .cc-chat-input, .cc-lexical-editor, .cc-rich-editor')) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if ((!canSwipeTabs && !isDetailPage) || touchStartX.current == null || touchStartY.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    const savedStartX = touchStartX.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2) return;

    // Edge swipe back on detail pages
    if (isDetailPage && savedStartX <= 20 && dx > 50) {
      navigate(-1);
      return;
    }

    if (!canSwipeTabs) return;

    if (dx < 0 && activeMobileTabIndex < mobileTabs.length - 1) {
      navigate(mobileTabs[activeMobileTabIndex + 1].to);
    } else if (dx > 0 && activeMobileTabIndex > 0) {
      navigate(mobileTabs[activeMobileTabIndex - 1].to);
    }
  };

  const handleRefresh = useCallback(() => { refresh(); }, [refresh]);

  // Persisted panel sizes
  const sidebarSize = useSettingsStore((s) => s.sidebarSize);
  const chatPanelSize = useSettingsStore((s) => s.chatPanelSize);
  const setSidebarSize = useSettingsStore((s) => s.setSidebarSize);
  const setChatPanelSize = useSettingsStore((s) => s.setChatPanelSize);

  const handleSidebarResize = useCallback((size: PanelSize) => {
    setSidebarSize(size.asPercentage);
    setSidebarCollapsed(size.asPercentage <= 4);
  }, [setSidebarSize]);

  const handleChatPanelResize = useCallback((size: PanelSize) => {
    setChatPanelSize(size.asPercentage);
  }, [setChatPanelSize]);

  const showChatPanel = !onChatPage && chatPanel.isOpen;

  const mobileMainContent = (
    <>
      <div className="cc-content" ref={contentRef}>
        <ErrorBoundary name="PageContent">
          <AnimatedOutlet />
        </ErrorBoundary>
      </div>
      <PullToRefresh contentRef={contentRef} onRefresh={handleRefresh} disabled={onChatPage} />
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
    <div className={`cc-root${isMobile ? ' cc-root--mobile' : ''}`} style={cssVars(colors)}>
      <UpdateNotification />
      <ToastContainer />
      <OfflineIndicator />
      <CommandPalette open={commandPalette.isOpen} onOpenChange={commandPalette.setIsOpen} />
      <ShortcutsHelp open={showShortcuts} onOpenChange={setShowShortcuts} />
      <QuickCaptureModal
        isOpen={quickCapture.isOpen}
        onClose={quickCapture.close}
        placeholder={quickCapture.placeholder || undefined}
        defaultParentId={quickCapture.defaultParentId}
      />

      {isMobile ? (
        <>
          {connectionStatus !== 'connected' && (
            <div className={`cc-mobile-status-bar cc-mobile-status-bar--${connectionStatus}`}>
              <span className="cc-mobile-status-bar__dot" />
              <span>{isFlushing ? 'Syncing...' : CONNECTION_LABELS[connectionStatus]}</span>
              {pendingCount > 0 && <span className="cc-offline-badge">{pendingCount}</span>}
            </div>
          )}
          <div className="cc-main" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>{mobileMainContent}</div>
          <FloatingActionButton />
          <BottomNav />
        </>
      ) : (
        <PanelGroup orientation="horizontal" id="cc-layout">
          <Panel
            id="sidebar"
            defaultSize={`${sidebarSize}%`}
            minSize="48px"
            maxSize="250px"
            collapsible
            collapsedSize="48px"
            onResize={handleSidebarResize}
          >
            {sidebar}
          </Panel>
          <PanelResizeHandle className="cc-resize-handle" />
          <Panel id="content" minSize="30%">
            <div className="cc-main">
              <div className="cc-content" ref={contentRef}>
                <ErrorBoundary name="PageContent">
                  <AnimatedOutlet />
                </ErrorBoundary>
              </div>
              {!onChatPage && !chatPanel.isOpen && (
                <ChatPanel
                  isOpen={false}
                  conversationId={chatPanel.conversationId}
                  onToggle={chatPanel.toggle}
                  onSetConversationId={chatPanel.setConversationId}
                />
              )}
            </div>
          </Panel>
          {showChatPanel && (
            <>
              <PanelResizeHandle className="cc-resize-handle" />
              <Panel
                id="chat-panel"
                defaultSize={`${chatPanelSize}%`}
                minSize="250px"
                maxSize="450px"
                onResize={handleChatPanelResize}
              >
                <ChatPanel
                  isOpen={true}
                  conversationId={chatPanel.conversationId}
                  onToggle={chatPanel.toggle}
                  onSetConversationId={chatPanel.setConversationId}
                  variant="side"
                />
              </Panel>
            </>
          )}
        </PanelGroup>
      )}
    </div>
  );
}
