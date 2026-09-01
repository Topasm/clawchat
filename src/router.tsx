import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './app/stores/useAuthStore';
import { useHostSessionStore } from './app/stores/useHostSessionStore';
import { useAutoLogin } from './app/hooks/useAutoLogin';
import ErrorBoundary from './app/components/shared/ErrorBoundary';
import { markStartupPhaseAfterPaint } from './app/services/startupPerformance';
import { hideStartupShell } from './app/services/startupSurface';
import { IS_DESKTOP } from './app/types/platform';
import { isWorkspaceSessionReady } from './app/services/nativeRoutePolicy';

// ── Lazy-loaded pages ────────────────────────────────────────────────
const Layout = lazy(() => import('./app/components/Layout'));
const WorkspaceStartRedirect = lazy(() => import('./app/pages/WorkspaceStartRedirect'));
const LoginPage = lazy(() => import('./app/pages/LoginPage'));
const OnboardingPage = lazy(() => import('./app/pages/OnboardingPage'));
const SchedulePage = lazy(() => import('./app/pages/SchedulePage'));
const InboxPage = lazy(() => import('./app/pages/InboxPage'));
const ChatListPage = lazy(() => import('./app/pages/ChatListPage'));
const ProjectWorkspacePage = lazy(() => import('./app/pages/ProjectWorkspacePage'));
const ReviewPage = lazy(() => import('./app/pages/ReviewPage'));
const RunsPage = lazy(() => import('./app/pages/RunsPage'));
const ChatPage = lazy(() => import('./app/pages/ChatPage'));
const AllTasksPage = lazy(() => import('./app/pages/AllTasksPage'));
const TaskDetailPage = lazy(() => import('./app/pages/TaskDetailPage'));
const EventDetailPage = lazy(() => import('./app/pages/EventDetailPage'));
const SettingsPage = lazy(() => import('./app/pages/SettingsPage'));
const SystemPromptPage = lazy(() => import('./app/pages/SystemPromptPage'));
const SearchPage = lazy(() => import('./app/pages/SearchPage'));
const AdminPage = lazy(() => import('./app/pages/AdminPage'));
const ConnectionCenterPage = lazy(() => import('./app/pages/ConnectionCenterPage'));
const DiagnosticsPage = lazy(() => import('./app/pages/DiagnosticsPage'));
const AppSettingsPage = lazy(() => import('./app/pages/AppSettingsPage'));

// ── Route-level suspense fallback ────────────────────────────────────
function PageFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 200,
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--cc-text-secondary)' }}>Loading...</div>
    </div>
  );
}

function RouteReadyMarker() {
  useEffect(() => {
    const cancelMark = markStartupPhaseAfterPaint('route_ready');
    hideStartupShell();
    return cancelMark;
  }, []);

  return null;
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageFallback />}>
      {children}
      <RouteReadyMarker />
    </Suspense>
  );
}

export default function AppRouter() {
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const healthOK = useAuthStore((s) => s.healthOK);
  const isLoading = useAuthStore((s) => s.isLoading);
  const hostPhase = useHostSessionStore((s) => s.phase);

  // Auto-login when the packaged Tauri host server is available.
  useAutoLogin();

  // Application, connection, and recovery controls belong to the native shell,
  // not to a workspace session. Keep them mountable while auth is rehydrating
  // and while the bundled server is blocked.
  const workspaceReady = isWorkspaceSessionReady({ token, healthOK, hostPhase });
  if (
    location.pathname === '/settings' ||
    location.pathname.startsWith('/settings/') ||
    location.pathname === '/connections' ||
    location.pathname === '/diagnostics'
  ) {
    return (
      <Routes>
        <Route
          path="/settings"
          element={<Navigate to="/settings/app" replace state={location.state} />}
        />
        <Route
          path="/settings/app"
          element={
            <LazyRoute>
              <AppSettingsPage />
            </LazyRoute>
          }
        />
        <Route
          path="/settings/workspace"
          element={
            workspaceReady ? (
              <LazyRoute>
                <SettingsPage />
              </LazyRoute>
            ) : (
              <Navigate to="/settings/app" replace state={location.state} />
            )
          }
        />
        <Route
          path="/settings/system-prompt"
          element={
            workspaceReady ? (
              <LazyRoute>
                <SystemPromptPage />
              </LazyRoute>
            ) : (
              <Navigate to="/settings/app" replace state={location.state} />
            )
          }
        />
        <Route
          path="/connections"
          element={
            <LazyRoute>
              <ConnectionCenterPage />
            </LazyRoute>
          }
        />
        <Route
          path="/diagnostics"
          element={
            <LazyRoute>
              <DiagnosticsPage />
            </LazyRoute>
          }
        />
        <Route path="/settings/*" element={<Navigate to="/settings/app" replace />} />
      </Routes>
    );
  }

  // Show nothing while rehydrating from localStorage
  if (isLoading) return null;

  // Do not mount the workspace with credentials restored from a previous
  // local-server process.  Re-authenticate the invisible local session first,
  // otherwise every eager TODO/calendar query fails once before the refresh
  // interceptor eventually sends the user back through login.
  if (IS_DESKTOP && hostPhase !== 'idle' && hostPhase !== 'connected') {
    return (
      <LazyRoute>
        <LoginPage />
      </LazyRoute>
    );
  }

  const isAuthenticated = !!token;

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <LazyRoute>
              <LoginPage />
            </LazyRoute>
          }
        />
        <Route
          path="/onboarding"
          element={
            <LazyRoute>
              <OnboardingPage />
            </LazyRoute>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <LazyRoute>
            <LoginPage />
          </LazyRoute>
        }
      />
      <Route
        path="/onboarding"
        element={
          <LazyRoute>
            <OnboardingPage />
          </LazyRoute>
        }
      />
      <Route
        element={
          <ErrorBoundary name="Layout">
            <LazyRoute>
              <Layout />
            </LazyRoute>
          </ErrorBoundary>
        }
      >
        <Route
          path="/"
          element={
            <LazyRoute>
              <WorkspaceStartRedirect />
            </LazyRoute>
          }
        />
        <Route path="/today" element={<Navigate to="/schedule/today" replace />} />
        <Route path="/schedule" element={<Navigate to="/schedule/today" replace />} />
        <Route
          path="/schedule/:view"
          element={
            <ErrorBoundary name="SchedulePage">
              <LazyRoute>
                <SchedulePage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/inbox"
          element={
            <ErrorBoundary name="InboxPage">
              <LazyRoute>
                <InboxPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects"
          element={
            <ErrorBoundary name="ProjectsPage">
              <LazyRoute>
                <ChatListPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId"
          element={
            <ErrorBoundary name="ProjectWorkspacePage">
              <LazyRoute>
                <ProjectWorkspacePage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/review"
          element={
            <ErrorBoundary name="ReviewPage">
              <LazyRoute>
                <ReviewPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/runs"
          element={
            <ErrorBoundary name="RunsPage">
              <LazyRoute>
                <RunsPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/chats"
          element={
            <ErrorBoundary name="ChatListPage">
              <LazyRoute>
                <ChatListPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/chats/:conversationId"
          element={
            <ErrorBoundary name="ChatPage">
              <LazyRoute>
                <ChatPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/tasks"
          element={
            <ErrorBoundary name="AllTasksPage">
              <LazyRoute>
                <AllTasksPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/tasks/:taskId"
          element={
            <ErrorBoundary name="TaskDetailPage">
              <LazyRoute>
                <TaskDetailPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route path="/calendar" element={<Navigate to="/schedule/month" replace />} />
        <Route
          path="/events/:eventId"
          element={
            <ErrorBoundary name="EventDetailPage">
              <LazyRoute>
                <EventDetailPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/search"
          element={
            <ErrorBoundary name="SearchPage">
              <LazyRoute>
                <SearchPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin"
          element={
            <ErrorBoundary name="AdminPage">
              <LazyRoute>
                <AdminPage />
              </LazyRoute>
            </ErrorBoundary>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
