import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './app/stores/useAuthStore';
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

export default function AppRouter() {
  const token = useAuthStore((s) => s.token);
  const isLoading = useAuthStore((s) => s.isLoading);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  // Show nothing while rehydrating from localStorage
  if (isLoading) return null;

  // Show login page only if not authenticated AND not in demo mode
  // Demo mode = no serverUrl set (user hasn't tried to connect)
  const isAuthenticated = !!token;
  const isDemoMode = !serverUrl && !token;

  if (!isAuthenticated && !isDemoMode) {
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
        <Route path="/today" element={<TodayPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/chats" element={<ChatListPage />} />
        <Route path="/chats/:conversationId" element={<ChatPage />} />
        <Route path="/tasks" element={<AllTasksPage />} />
        <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/system-prompt" element={<SystemPromptPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  );
}
