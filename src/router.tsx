import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './app/stores/useAuthStore';
import { useAutoLogin } from './app/hooks/useAutoLogin';
import ErrorBoundary from './app/components/shared/ErrorBoundary';
import Layout from './app/components/Layout';
import LoginPage from './app/pages/LoginPage';
import OnboardingPage from './app/pages/OnboardingPage';

// ── Lazy-loaded pages ────────────────────────────────────────────────
const TodayPage = lazy(() => import('./app/pages/TodayPage'));
const InboxPage = lazy(() => import('./app/pages/InboxPage'));
const ChatListPage = lazy(() => import('./app/pages/ChatListPage'));
const ChatPage = lazy(() => import('./app/pages/ChatPage'));
const AllTasksPage = lazy(() => import('./app/pages/AllTasksPage'));
const TaskDetailPage = lazy(() => import('./app/pages/TaskDetailPage'));
const EventDetailPage = lazy(() => import('./app/pages/EventDetailPage'));
const SettingsPage = lazy(() => import('./app/pages/SettingsPage'));
const SystemPromptPage = lazy(() => import('./app/pages/SystemPromptPage'));
const SearchPage = lazy(() => import('./app/pages/SearchPage'));
const CalendarPage = lazy(() => import('./app/pages/CalendarPage'));
const AdminPage = lazy(() => import('./app/pages/AdminPage'));

// ── Route-level suspense fallback ────────────────────────────────────
function PageFallback() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', minHeight: 200,
    }}>
      <div style={{ fontSize: 13, color: 'var(--cc-text-secondary)' }}>Loading...</div>
    </div>
  );
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

export default function AppRouter() {
  const token = useAuthStore((s) => s.token);
  const isLoading = useAuthStore((s) => s.isLoading);

  // Auto-login on Electron (reads config from main process)
  useAutoLogin();

  // Show nothing while rehydrating from localStorage
  if (isLoading) return null;

  const isAuthenticated = !!token;

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route element={<Layout />}>
        <Route path="/today" element={<ErrorBoundary name="TodayPage"><LazyRoute><TodayPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/inbox" element={<ErrorBoundary name="InboxPage"><LazyRoute><InboxPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/chats" element={<ErrorBoundary name="ChatListPage"><LazyRoute><ChatListPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/chats/:conversationId" element={<ErrorBoundary name="ChatPage"><LazyRoute><ChatPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/tasks" element={<ErrorBoundary name="AllTasksPage"><LazyRoute><AllTasksPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/tasks/:taskId" element={<ErrorBoundary name="TaskDetailPage"><LazyRoute><TaskDetailPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/calendar" element={<ErrorBoundary name="CalendarPage"><LazyRoute><CalendarPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/events/:eventId" element={<ErrorBoundary name="EventDetailPage"><LazyRoute><EventDetailPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/settings" element={<ErrorBoundary name="SettingsPage"><LazyRoute><SettingsPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/settings/system-prompt" element={<ErrorBoundary name="SystemPromptPage"><LazyRoute><SystemPromptPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/search" element={<ErrorBoundary name="SearchPage"><LazyRoute><SearchPage /></LazyRoute></ErrorBoundary>} />
        <Route path="/admin" element={<ErrorBoundary name="AdminPage"><LazyRoute><AdminPage /></LazyRoute></ErrorBoundary>} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  );
}
