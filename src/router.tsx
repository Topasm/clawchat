import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './app/components/Layout';
import TodayPage from './app/pages/TodayPage';
import InboxPage from './app/pages/InboxPage';
import ChatListPage from './app/pages/ChatListPage';
import ChatPage from './app/pages/ChatPage';
import AllTasksPage from './app/pages/AllTasksPage';
import TaskDetailPage from './app/pages/TaskDetailPage';
import EventDetailPage from './app/pages/EventDetailPage';
import SettingsPage from './app/pages/SettingsPage';
import SystemPromptPage from './app/pages/SystemPromptPage';

export default function AppRouter() {
  return (
    <Routes>
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
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  );
}
