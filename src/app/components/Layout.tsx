import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import type { PanelSize } from 'react-resizable-panels';
import { useTheme } from '../config/ThemeContext';
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
import { ChevronLeftIcon, ChevronRightIcon } from './shared/Icons';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { useCapabilitiesQuery, useReviewsQuery, useTodosQuery } from '../hooks/queries';
import { setAppBadge } from '../services/badgeService';
import useCommandPalette from '../hooks/useCommandPalette';
import { useGlobalShortcuts, useNavigationShortcuts } from '../keyboard';
import type { ColorPalette } from '../config/theme';
import type { HealthResponse } from '../types/api';
import { platformApi } from '../platform';

// --- SVG icon components ---
import {
  SunIcon,
  InboxIcon,
  ChatIcon,
  TasksIcon,
  GearIcon,
  SearchIcon,
  AdminIcon,
  NavCalendarIcon,
  ReviewIcon,
  RunsIcon,
} from './shared/NavIcons';
import BottomNav, { mobileTabs } from './shared/BottomNav';
import UpdateNotification from './shared/UpdateNotification';

// --- Theme bridge: map ColorPalette → CSS custom properties ---
function cssVars(colors: ColorPalette, fontSize: number): React.CSSProperties {
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
    '--cc-font-size': `${fontSize}px`,
  } as React.CSSProperties;
}

const CONNECTION_LABEL_KEYS: Record<ConnectionStatus, string> = {
  connected: 'connection.connected',
  disconnected: 'connection.disconnected',
  reconnecting: 'connection.reconnecting',
};

const primaryNavItems = [
  { to: '/today', labelKey: 'nav.today', Icon: SunIcon },
  { to: '/inbox', labelKey: 'nav.inbox', Icon: InboxIcon },
  { to: '/projects', labelKey: 'nav.projects', Icon: ChatIcon },
];

const secondaryNavItems = [
  { to: '/runs', labelKey: 'nav.runs', Icon: RunsIcon },
  { to: '/review', labelKey: 'nav.review', Icon: ReviewIcon },
  { to: '/tasks', labelKey: 'nav.tasks', Icon: TasksIcon },
  { to: '/search', labelKey: 'nav.search', Icon: SearchIcon },
  { to: '/calendar', labelKey: 'nav.calendar', Icon: NavCalendarIcon },
  { to: '/settings', labelKey: 'nav.settings', Icon: GearIcon },
  { to: '/admin', labelKey: 'nav.admin', Icon: AdminIcon },
];

// Flat list for backward compatibility (used in swipe navigation, etc.)
const navItems = [...primaryNavItems, ...secondaryNavItems];

export default function Layout() {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const fontSize = useSettingsStore((state) => state.fontSize);
  const compactMode = useSettingsStore((state) => state.compactMode);
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
  const { data: todos = [] } = useTodosQuery();
  const { data: pendingReviews = [] } = useReviewsQuery();

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

  // Desktop: global shortcut opens quick capture (Cmd/Ctrl+Shift+Space)
  useEffect(() => {
    if (!platformApi.runtime.isDesktop) return;
    return platformApi.events.on('open-quick-capture', () => {
      quickCapture.open();
    });
  }, [quickCapture]);

  // Web: keyboard shortcut 'Q' opens quick capture (when no input is focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable)
          return;
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
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
  const inboxCount = useMemo(
    () => todos.filter((todo) => !todo.due_date && todo.status === 'pending').length,
    [todos],
  );

  // Tasks that are due now or already late — what "needs attention today" means.
  const dueCount = useMemo(() => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    return todos.filter((todo) => {
      if (todo.status !== 'pending' || !todo.due_date) return false;
      const due = new Date(todo.due_date);
      return !Number.isNaN(due.getTime()) && due <= endOfToday;
    }).length;
  }, [todos]);

  const openTaskCount = useMemo(
    () => todos.filter((todo) => todo.status === 'pending' || todo.status === 'in_progress').length,
    [todos],
  );

  const navBadgeCounts = useMemo<Record<string, number>>(
    () => ({
      '/today': dueCount,
      '/inbox': inboxCount,
      '/tasks': openTaskCount,
      '/review': pendingReviews.length,
    }),
    [dueCount, inboxCount, openTaskCount, pendingReviews.length],
  );

  // The OS icon badge stands for "needs you now", so it counts unfiled work
  // plus anything due or overdue -- not the whole open backlog.
  useEffect(() => {
    void setAppBadge(inboxCount + dueCount);
  }, [inboxCount, dueCount]);

  // Hide ChatPanel when on full ChatPage
  const onChatPage = location.pathname.startsWith('/chats/') && location.pathname !== '/chats';

  const activeMobileTabIndex = useMemo(
    () =>
      mobileTabs.findIndex(
        (tab) => location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`),
      ),
    [location.pathname],
  );

  const canSwipeTabs = isMobile && !onChatPage && activeMobileTabIndex >= 0;
  const isDetailPage =
    isMobile &&
    (/^\/(tasks|chats|events|projects)\/[^/]+/.test(location.pathname) ||
      location.pathname === '/settings/system-prompt');

  const sidebar = (
    <nav className={`cc-sidebar${sidebarCollapsed ? ' cc-sidebar--collapsed' : ''}`}>
      <div className="cc-sidebar__header">
        <span className="cc-sidebar__title">{t('common.appName')}</span>
        <button
          className="cc-sidebar-toggle"
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={t(sidebarCollapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar')}
        >
          {sidebarCollapsed ? (
            <ChevronRightIcon size={16} className="cc-nav-icon" />
          ) : (
            <ChevronLeftIcon size={16} className="cc-nav-icon" />
          )}
        </button>
      </div>
      <div className={`cc-connection-status cc-connection-status--${connectionStatus}`}>
        <span className="cc-connection-status__dot" />
        <span className="cc-sidebar__label">
          {isFlushing ? t('connection.syncing') : t(CONNECTION_LABEL_KEYS[connectionStatus])}
          {pendingCount > 0 && (
            <span
              className="cc-offline-badge"
              title={t('connection.pending', { count: pendingCount })}
            >
              {pendingCount}
            </span>
          )}
        </span>
      </div>
      {healthData && (
        <div
          className={`cc-health-status cc-health-status--${healthData.ai_connected ? 'ok' : 'degraded'}`}
        >
          <span className="cc-health-status__dot" />
          <span className="cc-sidebar__label">
            AI: {healthData.ai_connected ? healthData.ai_model : t('connection.aiOffline')}
          </span>
        </div>
      )}
      {filteredPrimaryNavItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `cc-nav-item cc-nav-item--primary${isActive ? ' cc-nav-item--active' : ''}`
          }
          title={sidebarCollapsed ? t(item.labelKey) : undefined}
        >
          <item.Icon />
          <span className="cc-sidebar__label">{t(item.labelKey)}</span>
          {navBadgeCounts[item.to] > 0 && (
            <span className="cc-nav-badge">{navBadgeCounts[item.to]}</span>
          )}
        </NavLink>
      ))}
      <div className="cc-sidebar__divider" />
      {filteredSecondaryNavItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `cc-nav-item${isActive ? ' cc-nav-item--active' : ''}`}
          title={sidebarCollapsed ? t(item.labelKey) : undefined}
        >
          <item.Icon />
          <span className="cc-sidebar__label">{t(item.labelKey)}</span>
          {navBadgeCounts[item.to] > 0 && (
            <span className="cc-nav-badge">{navBadgeCounts[item.to]}</span>
          )}
        </NavLink>
      ))}
      <div className="cc-sidebar__spacer" />
    </nav>
  );

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!canSwipeTabs && !isDetailPage) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'input, textarea, button, [role="button"], [contenteditable="true"], .cc-chat-input, .cc-lexical-editor, .cc-rich-editor',
      )
    ) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (
      (!canSwipeTabs && !isDetailPage) ||
      touchStartX.current == null ||
      touchStartY.current == null
    )
      return;
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

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  // Persisted panel sizes
  const sidebarSize = useSettingsStore((s) => s.sidebarSize);
  const chatPanelSize = useSettingsStore((s) => s.chatPanelSize);
  const setSidebarSize = useSettingsStore((s) => s.setSidebarSize);
  const setChatPanelSize = useSettingsStore((s) => s.setChatPanelSize);

  const handleSidebarResize = useCallback(
    (size: PanelSize) => {
      setSidebarSize(size.asPercentage);
      setSidebarCollapsed(size.asPercentage <= 4);
    },
    [setSidebarSize],
  );

  const handleChatPanelResize = useCallback(
    (size: PanelSize) => {
      setChatPanelSize(size.asPercentage);
    },
    [setChatPanelSize],
  );

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
    <div
      className={`cc-root${isMobile ? ' cc-root--mobile' : ''}${isDark ? ' cc-root--dark' : ''}${compactMode && !isMobile ? ' cc-root--compact' : ''}`}
      style={cssVars(colors, fontSize)}
    >
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
              <span>
                {isFlushing ? t('connection.syncing') : t(CONNECTION_LABEL_KEYS[connectionStatus])}
              </span>
              {pendingCount > 0 && <span className="cc-offline-badge">{pendingCount}</span>}
            </div>
          )}
          <div className="cc-main" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            {mobileMainContent}
          </div>
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
