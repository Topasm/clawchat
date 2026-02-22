import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { wsClient } from '../services/wsClient';
import { useAuthStore } from '../stores/useAuthStore';
import { useChatStore, type ChatMessage } from '../stores/useChatStore';
import { useToastStore } from '../stores/useToastStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { notify } from '../services/platform';
import { queryKeys } from './queries';

/**
 * Connects to the server WebSocket on mount and wires up event handlers
 * for real-time updates (module data changes, reminders, task progress).
 */
export default function useWebSocket(): void {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!serverUrl || !token) return;

    wsClient.connect(serverUrl, token);

    // Sync connection status to auth store
    const unsubStatus = wsClient.onStatusChange((status) => {
      useAuthStore.getState().setConnectionStatus(status);
    });

    const handleModuleChange = (data: unknown) => {
      const d = data as { module?: string };
      if (d.module === 'todos') {
        queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      } else if (d.module === 'events') {
        queryClient.invalidateQueries({ queryKey: queryKeys.events });
      } else if (d.module === 'memos') {
        queryClient.invalidateQueries({ queryKey: queryKeys.memos });
      } else {
        // Refresh all
        queryClient.invalidateQueries({ queryKey: queryKeys.todos });
        queryClient.invalidateQueries({ queryKey: queryKeys.events });
        queryClient.invalidateQueries({ queryKey: queryKeys.memos });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    };

    const handleReminder = (data: unknown) => {
      const d = data as { title?: string; message?: string };
      const message = d.message ?? `Reminder: ${d.title ?? 'Upcoming event'}`;
      useToastStore.getState().addToast('warning', message, { duration: 10000 });
      if (useSettingsStore.getState().notificationsEnabled) {
        void notify('Reminder', message);
      }
    };

    const handleTaskCompleted = (data: unknown) => {
      const d = data as { task_id?: string; result?: string };
      const chatStore = useChatStore.getState();
      chatStore.updateTaskProgress?.(d.task_id ?? '', { status: 'completed', result: d.result });
      useToastStore.getState().addToast('success', 'Background task completed');
      if (useSettingsStore.getState().notificationsEnabled) {
        void notify('Task Complete', 'Background task finished');
      }
    };

    const handleTaskFailed = (data: unknown) => {
      const d = data as { task_id?: string; error?: string };
      const chatStore = useChatStore.getState();
      chatStore.updateTaskProgress?.(d.task_id ?? '', { status: 'failed', error: d.error });
      const errorMsg = d.error ?? 'Unknown error';
      useToastStore.getState().addToast('error', `Background task failed: ${errorMsg}`);
      if (useSettingsStore.getState().notificationsEnabled) {
        void notify('Task Failed', errorMsg);
      }
    };

    const handleTaskProgress = (data: unknown) => {
      const d = data as { task_id?: string; progress?: number; message?: string; status?: string };
      const chatStore = useChatStore.getState();
      chatStore.updateTaskProgress?.(d.task_id ?? '', d);
    };

    // --- AI stream events (from orchestrator /send path) ---

    const handleStreamStart = (data: unknown) => {
      const d = data as { message_id: string; conversation_id: string };
      const chatStore = useChatStore.getState();
      if (d.conversation_id !== chatStore.currentConversationId) return;

      const placeholder: ChatMessage = {
        _id: d.message_id,
        text: '',
        createdAt: new Date(),
        user: { _id: 'assistant', name: 'ClawChat' },
      };
      chatStore.addMessage(placeholder);
      chatStore.setStreamingState(true);
    };

    const handleStreamChunk = (data: unknown) => {
      const d = data as { message_id: string; content: string };
      useChatStore.getState().appendToMessage(d.message_id, d.content);
    };

    const handleStreamEnd = (data: unknown) => {
      const d = data as { message_id: string; full_content: string; metadata?: Record<string, unknown> };
      const chatStore = useChatStore.getState();
      chatStore.finalizeStreamMessage(d.message_id, d.full_content, d.metadata);
      chatStore.setStreamingState(false);
    };

    const handleConversationUpdated = (data: unknown) => {
      const d = data as { conversation_id: string; title?: string };
      if (d.title) {
        useChatStore.getState().updateConversationTitle(d.conversation_id, d.title);
      }
    };

    wsClient.on('module_data_changed', handleModuleChange);
    wsClient.on('reminder', handleReminder);
    wsClient.on('task_completed', handleTaskCompleted);
    wsClient.on('task_failed', handleTaskFailed);
    wsClient.on('task_progress', handleTaskProgress);
    wsClient.on('stream_start', handleStreamStart);
    wsClient.on('stream_chunk', handleStreamChunk);
    wsClient.on('stream_end', handleStreamEnd);
    wsClient.on('conversation_updated', handleConversationUpdated);

    return () => {
      unsubStatus();
      wsClient.off('module_data_changed', handleModuleChange);
      wsClient.off('reminder', handleReminder);
      wsClient.off('task_completed', handleTaskCompleted);
      wsClient.off('task_failed', handleTaskFailed);
      wsClient.off('task_progress', handleTaskProgress);
      wsClient.off('stream_start', handleStreamStart);
      wsClient.off('stream_chunk', handleStreamChunk);
      wsClient.off('stream_end', handleStreamEnd);
      wsClient.off('conversation_updated', handleConversationUpdated);
      wsClient.disconnect();
    };
  }, [serverUrl, token, queryClient]);
}
