import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './app/stores/useAuthStore';
import { useAutoLogin } from './app/hooks/useAutoLogin';
import { IS_ELECTRON } from './app/types/platform';
import ErrorBoundary from './app/components/shared/ErrorBoundary';
import Layout from './app/components/Layout';
import LoginPage from './app/pages/LoginPage';
import TodayPage from './app/pages/TodayPage';
import InboxPage from './app/pages/InboxPage';
import ChatListPage from './app/pages/ChatListPage';
import ChatPage from './app/pages/ChatPage';
import AllTasksPage from './app/pages/AllTasksPage';
import TaskDetailPage from './app/pages/TaskDetailPage';
import EventDetailPage from './app/pages/EventDetailPage';
import SettingsPage from './app/pages/SettingsPage';
import SystemPromptPage from './app/pages/SystemPromptPage';
import SearchPage from './app/pages/SearchPage';
import MemosPage from './app/pages/MemosPage';
import CalendarPage from './app/pages/CalendarPage';
import AdminPage from './app/pages/AdminPage';

export default function AppRouter() {
  const token = useAuthStore((s) => s.token);
  const isLoading = useAuthStore((s) => s.isLoading);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  // Auto-login on Electron (reads config from main process)
  useAutoLogin();

  // Show nothing while rehydrating from localStorage
  if (isLoading) return null;

  const isAuthenticated = !!token;
  // Demo mode: no serverUrl AND no token (fresh state or explicit "Skip to Demo")
  const isDemoMode = !serverUrl && !token;

  // On Electron, show splash while server is starting and auto-login hasn't completed
  if (IS_ELECTRON && !isAuthenticated && !isDemoMode) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>ClawChat</div>
        <div style={{ fontSize: 13, color: 'var(--cc-text-secondary)' }}>Starting server...</div>
      </div>
    );
  }

  // Allow access when authenticated OR in demo mode
  if (!isAuthenticated && !isDemoMode) {
    // User has a serverUrl set but no valid token -> need to login
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/today" element={<ErrorBoundary name="TodayPage"><TodayPage /></ErrorBoundary>} />
        <Route path="/inbox" element={<ErrorBoundary name="InboxPage"><InboxPage /></ErrorBoundary>} />
        <Route path="/chats" element={<ErrorBoundary name="ChatListPage"><ChatListPage /></ErrorBoundary>} />
        <Route path="/chats/:conversationId" element={<ErrorBoundary name="ChatPage"><ChatPage /></ErrorBoundary>} />
        <Route path="/tasks" element={<ErrorBoundary name="AllTasksPage"><AllTasksPage /></ErrorBoundary>} />
        <Route path="/tasks/:taskId" element={<ErrorBoundary name="TaskDetailPage"><TaskDetailPage /></ErrorBoundary>} />
        <Route path="/calendar" element={<ErrorBoundary name="CalendarPage"><CalendarPage /></ErrorBoundary>} />
        <Route path="/events/:eventId" element={<ErrorBoundary name="EventDetailPage"><EventDetailPage /></ErrorBoundary>} />
        <Route path="/settings" element={<ErrorBoundary name="SettingsPage"><SettingsPage /></ErrorBoundary>} />
        <Route path="/settings/system-prompt" element={<ErrorBoundary name="SystemPromptPage"><SystemPromptPage /></ErrorBoundary>} />
        <Route path="/search" element={<ErrorBoundary name="SearchPage"><SearchPage /></ErrorBoundary>} />
        <Route path="/memos" element={<ErrorBoundary name="MemosPage"><MemosPage /></ErrorBoundary>} />
        <Route path="/admin" element={<ErrorBoundary name="AdminPage"><AdminPage /></ErrorBoundary>} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  );
}
