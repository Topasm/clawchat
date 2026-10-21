import { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation, translateUi } from '../i18n';
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  usePanelRef,
} from 'react-resizable-panels';
import type { Layout as PanelLayout, LayoutChangedMeta, PanelSize } from 'react-resizable-panels';
import { useTheme } from '../config/ThemeContext';
import { useSettingsStore } from '../stores/useSettingsStore';
import ChatPanel from './chat-panel/ChatPanel';
import TaskPane, { type TaskPaneMode } from './task-detail/TaskPane';
import { ChatPanelControllerProvider } from './chat-panel/ChatPanelControllerContext';
import ErrorBoundary from './shared/ErrorBoundary';
import useChatPanel from '../hooks/useChatPanel';
import { useOpenTaskChat, useToggleContextChat } from '../hooks/useContextChat';
import { useCloseTaskPane, useOpenTask, useSelectedTaskId } from '../hooks/useTaskPane';
import usePlatform from '../hooks/usePlatform';
import useMediaQuery from '../hooks/useMediaQuery';
import useDataSync from '../hooks/useDataSync';
import useWebSocket from '../hooks/useWebSocket';
import useNetworkStatus from '../hooks/useNetworkStatus';
import useDataSourceSharing from '../hooks/useDataSourceSharing';
import useWorkerRunner from '../hooks/useWorkerRunner';
import { useAuthStore } from '../stores/useAuthStore';
import type { ConnectionStatus } from '../stores/useAuthStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import AnimatedOutlet from './AnimatedOutlet';
import MotionProvider from './shared/MotionProvider';
import ToastContainer from './shared/ToastContainer';
import CommandPalette from './shared/CommandPalette';
import ShortcutsHelp from './shared/ShortcutsHelp';
import QuickCaptureModal from './shared/QuickCaptureModal';
import OfflineIndicator from './shared/OfflineIndicator';
import FloatingActionButton from './shared/FloatingActionButton';
import PullToRefresh from './shared/PullToRefresh';
import { ChatBubbleIcon, ChevronLeftIcon, ChevronRightIcon } from './shared/Icons';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import {
  useAgentRunsQuery,
  useCapabilitiesQuery,
  useReviewsQuery,
  useRunsAwaitingInputQuery,
  useTodosQuery,
} from '../hooks/queries';
import { setAppBadge } from '../services/badgeService';
import useCommandPalette from '../hooks/useCommandPalette';
import useProjectRootIds from '../hooks/useProjectRootIds';
import { useGlobalShortcuts, useNavigationShortcuts } from '../keyboard';
import type { ColorPalette } from '../config/theme';
import type { TodoResponse } from '../types/api';
// --- SVG icon components ---
import { InboxIcon, TasksIcon, NavCalendarIcon, ProgressIcon, TodayIcon } from './shared/NavIcons';
import SidebarProjects from './shared/SidebarProjects';
import BottomNav, { mobileTabs } from './shared/BottomNav';
import { isTaskTodo } from '../utils/inboxState';
import { getAttentionBadgeCounts } from '../utils/attentionBadge';
import UpdateNotification from './shared/UpdateNotification';
import { useServerHealthStore } from '../stores/useServerHealthStore';
import { useServerHealthPolling } from '../hooks/useServerHealth';
import { activeWorkspaceName, workspaceAddressLabel } from '../utils/workspaceLocation';
import { platformApi } from '../platform';
import ActiveRunsLine from './shared/ActiveRunsLine';
import WorkerStatusLine from './shared/WorkerStatusLine';
import WorkspaceMenu from './shared/WorkspaceMenu';
import { isRunExecuting } from '../utils/taskStage';

const SimpleMode = lazy(() => import('./SimpleMode'));
// Keep the injected theme tokens declared in this runtime root. The design
// token audit reads this bridge to distinguish runtime variables from typos.
function cssVars(colors: ColorPalette, fontSize: number): React.CSSProperties {
  return {
    '--cc-background': colors.background,
    '--cc-sidebar': colors.sidebar,
    '--cc-surface': colors.surface,
    '--cc-surface-secondary': colors.surfaceSecondary,
    '--cc-text': colors.text,
    '--cc-text-secondary': colors.textSecondary,
    '--cc-text-tertiary': colors.textTertiary,
    '--cc-border': colors.border,
    '--cc-connector': colors.connector,
    '--cc-disabled': colors.disabled,
    '--cc-primary': colors.primary,
    '--cc-primary-light': colors.primaryLight,
    '--cc-primary-dark': colors.primaryDark,
    '--cc-link': colors.link,
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
// The five places, each with its own coloured icon; projects follow as a list
// of their own. Progress is where everything agents stopped on or are doing
// lives; the run log and review history are views of it. Search, settings,
// devices and automations live in the workspace menu at the sidebar's foot.
interface NavItem {
  to: string;
  labelKey: string;
  Icon: typeof InboxIcon;
  tone: string;
  isActive?: (pathname: string) => boolean;
}
const primaryNavItems: NavItem[] = [
  { to: '/inbox', labelKey: 'nav.inbox', Icon: InboxIcon, tone: 'inbox' },
  {
    to: '/schedule/today',
    labelKey: 'nav.today',
    Icon: TodayIcon,
    tone: 'today',
    isActive: (pathname) => pathname === '/schedule/today',
  },
  {
    to: '/schedule/week',
    labelKey: 'nav.schedule',
    Icon: NavCalendarIcon,
    tone: 'schedule',
    isActive: (pathname) => pathname.startsWith('/schedule') && pathname !== '/schedule/today',
  },
  { to: '/tasks', labelKey: 'nav.tasks', Icon: TasksIcon, tone: 'tasks' },
  { to: '/attention', labelKey: 'nav.attention', Icon: ProgressIcon, tone: 'progress' },
];
/** The name of the screen a path shows, as the sidebar prints it. */
/** Below this width the task pane covers the list rather than sitting beside it. */
const NARROW_DESKTOP_QUERY = '(max-width: 1439px)';

export function screenName(pathname: string, t: (key: string) => string): string {
  const first = pathname.split('/')[1] ?? '';
  const keys: Record<string, string> = {
    inbox: 'nav.inbox',
    tasks: 'nav.tasks',
    schedule: 'nav.schedule',
    projects: 'nav.projects',
    attention: 'nav.attention',
    automations: 'nav.automations',
    devices: 'nav.devices',
    search: 'nav.search',
    settings: 'nav.settings',
    more: 'nav.more',
  };
  return keys[first] ? t(keys[first]) : t('common.appName');
}
const SIDEBAR_RAIL_WIDTH = 48;
const SIDEBAR_EXPANDED_MIN_WIDTH = 160;
const DEFAULT_SIDEBAR_SIZE = 18;
const NO_TODO_COUNTS = { inboxCount: 0, dueCount: 0, attentionBadgeCount: 0, openTaskCount: 0 };
export default function Layout() {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const fontSize = useSettingsStore((state) => state.fontSize);
  const compactMode = useSettingsStore((state) => state.compactMode);
  const simpleMode = useSettingsStore((state) => state.simpleMode);
  const location = useLocation();
  const navigate = useNavigate();
  const chatPanel = useChatPanel();
  const commandPalette = useCommandPalette();
  const { isDesktop, isMobile } = usePlatform();
  // The right-hand pane on desktop: the task picked from a list (?task=<id>)
  // or the AI conversation, one slot with a segmented header choosing which.
  const selectedTaskId = useSelectedTaskId();
  // On a 13-inch screen a third column squeezes the list, so the pane opens
  // over it instead of beside it.
  const paneOverlays = useMediaQuery(NARROW_DESKTOP_QUERY);
  const closeTaskPane = useCloseTaskPane();
  const openTask = useOpenTask();
  const openTaskChat = useOpenTaskChat(chatPanel);
  const [paneMode, setPaneMode] = useState<TaskPaneMode>('task');
  const chatOpen = chatPanel.open;
  const chatClose = chatPanel.close;
  useEffect(() => {
    setPaneMode(chatPanel.isOpen ? 'chat' : 'task');
  }, [chatPanel.isOpen]);
  useEffect(() => {
    // Picking a task brings it in front of the conversation.
    if (selectedTaskId) {
      setPaneMode('task');
      chatClose();
    }
  }, [chatClose, selectedTaskId]);
  useEffect(() => {
    // A phone-sized screen has no room beside the list: the task gets its page.
    if (isMobile && selectedTaskId) navigate(`/tasks/${selectedTaskId}`, { replace: true });
  }, [isMobile, navigate, selectedTaskId]);
  const setPane = useCallback(
    (mode: TaskPaneMode) => {
      if (mode === 'chat') {
        // The AI segment talks about the task in the pane.
        if (selectedTaskId) void openTaskChat(selectedTaskId);
        else chatOpen();
      } else {
        setPaneMode('task');
        chatClose();
      }
    },
    [chatClose, chatOpen, openTaskChat, selectedTaskId],
  );
  const closePane = useCallback(() => {
    closeTaskPane();
    chatClose();
  }, [chatClose, closeTaskPane]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarPanelRef = usePanelRef();
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const quickCaptureOpen = useQuickCaptureStore((state) => state.isOpen);
  const quickCaptureParentId = useQuickCaptureStore((state) => state.defaultParentId);
  const openQuickCapture = useQuickCaptureStore((state) => state.open);
  const closeQuickCapture = useQuickCaptureStore((state) => state.close);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const { data: capabilities } = useCapabilitiesQuery();
  const projectRootIds = useProjectRootIds();
  // Select the counts, not the list, so a todo edit that leaves every badge
  // where it was does not re-render the whole shell.
  const selectTodoCounts = useCallback(
    (todos: TodoResponse[]) => {
      const { inboxCount, dueCount, total } = getAttentionBadgeCounts(todos);
      const openTaskCount = todos.filter(
        (todo) =>
          isTaskTodo(todo) &&
          !projectRootIds.has(todo.id) &&
          (todo.status === 'pending' || todo.status === 'in_progress'),
      ).length;
      return { inboxCount, dueCount, attentionBadgeCount: total, openTaskCount };
    },
    [projectRootIds],
  );
  const { data: { inboxCount, dueCount, attentionBadgeCount, openTaskCount } = NO_TODO_COUNTS } =
    useTodosQuery(true, selectTodoCounts);
  const { data: pendingReviews = [] } = useReviewsQuery();
  const { data: runsAwaitingInput = [] } = useRunsAwaitingInputQuery();
  const { data: agentRuns = [] } = useAgentRunsQuery();
  const runningCount = useMemo(
    () => agentRuns.filter((run) => isRunExecuting(run.status)).length,
    [agentRuns],
  );
  useEffect(() => {
    if (!isDesktop) return;
    void platformApi.appWindow
      .setWorkspaceViewMode(simpleMode ? 'simple' : 'expanded')
      .catch((error) => console.warn('Failed to resize the workspace window:', error));
  }, [isDesktop, simpleMode]);
  // Conditionally filter nav items based on server capabilities
  const filteredPrimaryNavItems = useMemo(() => {
    if (!serverUrl) return primaryNavItems.filter((item) => item.to !== '/inbox');
    if (!capabilities) return primaryNavItems;
    return primaryNavItems.filter((item) => {
      if (item.to === '/inbox' && !capabilities.features.inbox_pipeline) return false;
      return true;
    });
  }, [capabilities, serverUrl]);
  const availableMobileTabs = useMemo(
    () =>
      !serverUrl || capabilities?.features.inbox_pipeline === false
        ? mobileTabs.filter((item) => item.to !== '/inbox')
        : mobileTabs,
    [capabilities, serverUrl],
  );
  // Widget deep-link navigation
  useEffect(() => {
    const handler = ((e: CustomEvent<string>) => {
      if (e.detail) navigate(e.detail);
    }) as EventListener;
    window.addEventListener('navigate', handler);
    return () => window.removeEventListener('navigate', handler);
  }, [navigate]);
  // Web: keyboard shortcut 'Q' opens quick capture (when no input is focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable)
          return;
        e.preventDefault();
        openQuickCapture();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openQuickCapture]);
  // Central data sync: fetches all data from server on mount (no-op in demo mode)
  const { refresh } = useDataSync();
  // Offline queue: monitor network status and flush on reconnect
  const { isFlushing, pendingCount } = useNetworkStatus(refresh);
  // Health check polling
  useServerHealthPolling();
  const healthData = useServerHealthStore((s) => (s.serverUrl === serverUrl ? s.health : null));
  // WebSocket connection for real-time updates
  useWebSocket();
  // Wire global keyboard shortcuts
  const toggleContextChat = useToggleContextChat(chatPanel);
  const toggleChat = useCallback(() => {
    if (selectedTaskId && !isMobile) {
      setPane(paneMode === 'chat' ? 'task' : 'chat');
      return;
    }
    toggleContextChat();
  }, [isMobile, paneMode, selectedTaskId, setPane, toggleContextChat]);
  useGlobalShortcuts({
    onToggleChat: toggleChat,
    onNewItem: () => {
      // The Inbox has the input on the page; elsewhere the same input opens.
      const inboxInput = document.querySelector<HTMLInputElement>('.cc-inbox-capture__input');
      if (inboxInput) inboxInput.focus();
      else openQuickCapture();
    },
    onShowHelp: () => setShowShortcuts(true),
  });
  useNavigationShortcuts();
  // Collects the work addressed to this machine while the app is open.
  useWorkerRunner();
  useDataSourceSharing();
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const workspaceName = useWorkspaceStore(activeWorkspaceName);
  const connectionLabel = isFlushing
    ? t('connection.syncing')
    : t(CONNECTION_LABEL_KEYS[connectionStatus]);
  const navBadgeCounts = useMemo<Record<string, number>>(
    () => ({
      '/schedule': dueCount,
      '/schedule/today': dueCount,
      '/inbox': inboxCount,
      '/tasks': openTaskCount,
      '/attention': pendingReviews.length + runsAwaitingInput.length,
    }),
    [dueCount, inboxCount, openTaskCount, pendingReviews.length, runsAwaitingInput.length],
  );
  // The OS icon badge stands for "needs you now": unfiled work, anything due
  // or overdue, and every agent that has stopped for your input or review --
  // not the whole open backlog.
  const agentAttentionCount = runsAwaitingInput.length + pendingReviews.length;
  useEffect(() => {
    void setAppBadge(attentionBadgeCount + agentAttentionCount);
  }, [attentionBadgeCount, agentAttentionCount]);
  // The full chat page is the conversation itself; the panel steps aside there.
  const onChatPage = location.pathname.startsWith('/chats/') && location.pathname !== '/chats';
  const onInboxPage = location.pathname === '/inbox';
  const activeMobileTabIndex = useMemo(
    () =>
      availableMobileTabs.findIndex(
        (tab) => location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`),
      ),
    [availableMobileTabs, location.pathname],
  );
  const canSwipeTabs = isMobile && !onChatPage && activeMobileTabIndex >= 0;
  const isDetailPage =
    isMobile && /^\/(tasks|chats|events|projects)\/[^/]+/.test(location.pathname);
  const handleSidebarToggle = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, [sidebarPanelRef]);
  const attentionCount = navBadgeCounts['/attention'];
  // Progress says what waits and what runs, in words, not a number alone.
  const progressBadge = [
    attentionCount > 0 ? translateUi('Check {{count}}', { count: attentionCount }) : null,
    runningCount > 0 ? translateUi('Running {{count}}', { count: runningCount }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const sidebar = (
    <nav className={`cc-sidebar${sidebarCollapsed ? ' cc-sidebar--collapsed' : ''}`}>
      <div className="cc-sidebar__header">
        <span className="cc-sidebar__title">{t('common.appName')}</span>
        <span className="cc-sidebar__header-actions">
          <button
            className="cc-sidebar-toggle"
            onClick={handleSidebarToggle}
            aria-label={t(sidebarCollapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar')}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? (
              <ChevronRightIcon size={16} className="cc-nav-icon" />
            ) : (
              <ChevronLeftIcon size={16} className="cc-nav-icon" />
            )}
          </button>
        </span>
      </div>
      <div className="cc-sidebar__scroll">
        {filteredPrimaryNavItems.map((item) => {
          const active = item.isActive
            ? item.isActive(location.pathname)
            : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`cc-nav-item cc-nav-item--primary cc-nav-item--${item.tone}${active ? ' cc-nav-item--active' : ''}`}
              aria-current={active ? 'page' : undefined}
              title={sidebarCollapsed ? t(item.labelKey) : undefined}
            >
              <item.Icon />
              <span className="cc-sidebar__label">{t(item.labelKey)}</span>
              {item.to === '/attention'
                ? progressBadge && (
                    <span className="cc-nav-badge cc-nav-badge--attention">{progressBadge}</span>
                  )
                : navBadgeCounts[item.to] > 0 && (
                    <span className="cc-nav-badge">{navBadgeCounts[item.to]}</span>
                  )}
            </NavLink>
          );
        })}
        {serverUrl && <SidebarProjects collapsed={sidebarCollapsed} />}
      </div>
      <ActiveRunsLine />
      <WorkerStatusLine />
      <WorkspaceMenu
        workspaceName={workspaceName}
        connectionStatus={connectionStatus}
        connectionLabel={connectionLabel}
        address={workspaceAddressLabel(serverUrl)}
        aiLabel={
          healthData
            ? `${translateUi('AI: ')}${healthData.aiConnected ? healthData.aiModel : t('connection.aiOffline')}`
            : null
        }
        pendingCount={pendingCount}
        collapsed={sidebarCollapsed}
        onOpenSearch={() => commandPalette.setIsOpen(true)}
      />
    </nav>
  );
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!canSwipeTabs && !isDetailPage) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'input, textarea, button, [role="button"], [contenteditable="true"], .cc-chat-input',
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
    if (dx < 0 && activeMobileTabIndex < availableMobileTabs.length - 1) {
      navigate(availableMobileTabs[activeMobileTabIndex + 1].to);
    } else if (dx > 0 && activeMobileTabIndex > 0) {
      navigate(availableMobileTabs[activeMobileTabIndex - 1].to);
    }
  };
  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);
  // Persisted panel sizes
  const sidebarSize = useSettingsStore((s) => s.sidebarSize);
  const chatPanelSize = useSettingsStore((s) => s.chatPanelSize);
  const taskPaneSize = useSettingsStore((s) => s.taskPaneSize);
  const setSidebarSize = useSettingsStore((s) => s.setSidebarSize);
  const setChatPanelSize = useSettingsStore((s) => s.setChatPanelSize);
  const setTaskPaneSize = useSettingsStore((s) => s.setTaskPaneSize);
  const handleSidebarResize = useCallback((size: PanelSize) => {
    setSidebarCollapsed(size.inPixels <= SIDEBAR_RAIL_WIDTH + 1);
  }, []);
  // Save sizes once a drag ends, not on every frame of it: each save rewrites
  // the persisted settings and re-renders the shell.
  const handlePanelLayoutChanged = useCallback(
    (layout: PanelLayout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;
      const sidebar = layout.sidebar;
      if (sidebar !== undefined && !sidebarPanelRef.current?.isCollapsed()) {
        setSidebarSize(sidebar);
      }
      const chat = layout['chat-panel'];
      if (chat !== undefined) setChatPanelSize(chat);
      const pane = layout['task-pane'];
      if (pane !== undefined) setTaskPaneSize(pane);
    },
    [setChatPanelSize, setSidebarSize, setTaskPaneSize, sidebarPanelRef],
  );
  // No chat bar waits at the foot of the page: the panel opens on ⌘K or the
  // top-right button, about the task or project on screen.
  // The panel is a conversation about the screen in view, and its title says
  // which one; a project, task or run thread keeps its own name.
  const panelTitle =
    chatPanel.presentation.kind === 'quick'
      ? `${translateUi('AI')} · ${screenName(location.pathname, t)}`
      : chatPanel.presentation.title;
  const showTaskPane = !onChatPage && !isMobile && Boolean(selectedTaskId);
  const taskPane = selectedTaskId && (
    <TaskPane
      taskId={selectedTaskId}
      mode={paneMode}
      onModeChange={setPane}
      onOpenTask={openTask}
      onClose={closePane}
      chat={{
        conversationId: chatPanel.conversationId,
        onSetConversationId: chatPanel.setConversationId,
        title: chatPanel.presentation.title,
        subtitle: chatPanel.presentation.subtitle,
      }}
    />
  );
  const showChatPanel = !onChatPage && chatPanel.isOpen && !showTaskPane;
  const aiToggle = !onChatPage && !chatPanel.isOpen && (
    <button
      type="button"
      className="cc-ai-toggle"
      onClick={toggleChat}
      aria-label={translateUi('Talk with AI')}
      title={translateUi('Talk with AI (⌘K)')}
    >
      <ChatBubbleIcon size={16} />
    </button>
  );
  const mobileMainContent = (
    <>
      <div className="cc-content" ref={contentRef}>
        <ErrorBoundary name="PageContent">
          <AnimatedOutlet />
        </ErrorBoundary>
      </div>
      <PullToRefresh contentRef={contentRef} onRefresh={handleRefresh} disabled={onChatPage} />
      {aiToggle}
      {showChatPanel && (
        <ChatPanel
          isOpen
          conversationId={chatPanel.conversationId}
          onToggle={chatPanel.toggle}
          onSetConversationId={chatPanel.setConversationId}
          title={panelTitle}
          subtitle={chatPanel.presentation.subtitle}
        />
      )}
    </>
  );
  return (
    <MotionProvider>
      <ChatPanelControllerProvider controller={chatPanel}>
        <div
          className={`cc-root${isMobile ? ' cc-root--mobile' : ''}${isDark ? ' cc-root--dark' : ''}${compactMode && !isMobile ? ' cc-root--compact' : ''}${isDesktop && simpleMode ? ' cc-root--simple' : ''}`}
          style={cssVars(colors, fontSize)}
        >
          <UpdateNotification />
          <ToastContainer />
          <OfflineIndicator />
          <CommandPalette open={commandPalette.isOpen} onOpenChange={commandPalette.setIsOpen} />
          <ShortcutsHelp open={showShortcuts} onOpenChange={setShowShortcuts} />
          <QuickCaptureModal
            isOpen={quickCaptureOpen}
            onClose={closeQuickCapture}
            defaultParentId={quickCaptureParentId}
          />

          {isDesktop && simpleMode ? (
            <Suspense fallback={null}>
              <SimpleMode />
            </Suspense>
          ) : isMobile ? (
            <>
              <div className="cc-main" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
                {mobileMainContent}
              </div>
              {!chatPanel.isOpen && !onInboxPage && <FloatingActionButton />}
              <BottomNav
                tabs={availableMobileTabs}
                badges={{
                  '/inbox': navBadgeCounts['/inbox'],
                  '/attention': navBadgeCounts['/attention'],
                }}
              />
            </>
          ) : (
            <>
              <PanelGroup
                orientation="horizontal"
                id="cc-layout"
                onLayoutChanged={handlePanelLayoutChanged}
              >
                <Panel
                  id="sidebar"
                  panelRef={sidebarPanelRef}
                  defaultSize={`${sidebarSize <= 4 ? DEFAULT_SIDEBAR_SIZE : sidebarSize}%`}
                  minSize={`${SIDEBAR_EXPANDED_MIN_WIDTH}px`}
                  maxSize="250px"
                  collapsible
                  collapsedSize={`${SIDEBAR_RAIL_WIDTH}px`}
                  onResize={handleSidebarResize}
                >
                  {sidebar}
                </Panel>
                <PanelResizeHandle className="cc-resize-handle" />
                <Panel id="content" minSize="30%">
                  <div className={`cc-main${aiToggle ? ' cc-main--ai-toggle' : ''}`}>
                    {aiToggle}
                    <div className="cc-content" ref={contentRef}>
                      <ErrorBoundary name="PageContent">
                        <AnimatedOutlet />
                      </ErrorBoundary>
                    </div>
                    {!chatPanel.isOpen && <FloatingActionButton />}
                  </div>
                </Panel>
                {showTaskPane && !paneOverlays && (
                  <>
                    <PanelResizeHandle className="cc-resize-handle" />
                    <Panel
                      id="task-pane"
                      defaultSize={`${taskPaneSize}%`}
                      minSize="460px"
                      maxSize="640px"
                    >
                      {taskPane}
                    </Panel>
                  </>
                )}
                {showChatPanel && (
                  <>
                    <PanelResizeHandle className="cc-resize-handle" />
                    <Panel
                      id="chat-panel"
                      defaultSize={`${chatPanelSize}%`}
                      minSize="250px"
                      maxSize="450px"
                    >
                      <ChatPanel
                        isOpen={true}
                        conversationId={chatPanel.conversationId}
                        onToggle={chatPanel.toggle}
                        onSetConversationId={chatPanel.setConversationId}
                        title={panelTitle}
                        subtitle={chatPanel.presentation.subtitle}
                        variant="side"
                      />
                    </Panel>
                  </>
                )}
              </PanelGroup>
              {showTaskPane && paneOverlays && (
                <div className="cc-detail-pane-overlay">
                  <div
                    className="cc-detail-pane-overlay__scrim"
                    aria-hidden="true"
                    onClick={closePane}
                  />
                  <div className="cc-detail-pane-overlay__sheet">{taskPane}</div>
                </div>
              )}
            </>
          )}
        </div>
      </ChatPanelControllerProvider>
    </MotionProvider>
  );
}
