import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { wsClient } from '../services/wsClient';
import { useAuthStore } from '../stores/useAuthStore';
import { useChatStore, clearPendingRunTimeout, type ChatMessage } from '../stores/useChatStore';
import { useToastStore } from '../stores/useToastStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { notify } from '../services/platform';
import { queryKeys } from './queries';
import type { ConversationResponse } from '../types/api';

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

    // Fail pending streaming state on disconnect so the UI doesn't get stuck
    wsClient.onDisconnect = () => {
      const { isStreaming, clearStreamingState } = useChatStore.getState();
      if (isStreaming) {
        clearStreamingState();
        useToastStore.getState().addToast('error', 'Connection lost during response. Reconnecting...');
      }
    };

    const handleModuleChange = (data: unknown) => {
      const d = data as { module?: string };
      if (d.module === 'todos') {
        queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      } else if (d.module === 'events') {
        queryClient.invalidateQueries({ queryKey: queryKeys.events });
      } else {
        // Refresh all
        queryClient.invalidateQueries({ queryKey: queryKeys.todos });
        queryClient.invalidateQueries({ queryKey: queryKeys.events });
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
      chatStore.addStreamingMessage(placeholder);
      chatStore.setStreamingState(true);
    };

    const handleStreamChunk = (data: unknown) => {
      const d = data as { message_id: string; content: string };
      useChatStore.getState().appendToMessage(d.message_id, d.content);
    };

    const handleStreamEnd = (data: unknown) => {
      const d = data as { message_id: string; full_content: string; metadata?: Record<string, unknown>; conversation_id?: string };
      clearPendingRunTimeout();
      const chatStore = useChatStore.getState();
      chatStore.finalizeStreamMessage(d.message_id, d.full_content, d.metadata);
      chatStore.setStreamingState(false);
      // Invalidate messages query to pick up finalized message from server
      const conversationId = d.conversation_id || chatStore.currentConversationId;
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      }
    };

    const handleStreamError = (data: unknown) => {
      const d = data as { conversation_id?: string; error_message?: string; message?: string };
      clearPendingRunTimeout();
      const conversationId = d.conversation_id || useChatStore.getState().currentConversationId;
      useChatStore.setState({
        isStreaming: false,
        streamAbortController: null
      });
      const errorMsg = d.error_message || d.message || 'An error occurred while generating a response';
      useToastStore.getState().addToast('error', errorMsg);
      // Reload messages to get authoritative server state
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
      }
    };

    const handleStreamAborted = (data: unknown) => {
      const d = data as { conversation_id?: string };
      clearPendingRunTimeout();
      const conversationId = d.conversation_id || useChatStore.getState().currentConversationId;
      useChatStore.setState({
        isStreaming: false,
        streamAbortController: null
      });
      // Reload messages to get authoritative server state
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
      }
    };

    const handleConversationUpdated = (data: unknown) => {
      const d = data as { conversation_id: string; title?: string };
      if (d.title) {
        // Update conversation title in query cache
        queryClient.setQueryData<ConversationResponse[]>(queryKeys.conversations, (old) =>
          (old ?? []).map((c) => (c.id === d.conversation_id ? { ...c, title: d.title! } : c)),
        );
      }
    };

    // Server liveness signals — wsClient already tracked lastMessageTime; ignore here
    const handleLivenessNoop = () => {};
    wsClient.on('tick', handleLivenessNoop);
    wsClient.on('heartbeat', handleLivenessNoop);
    wsClient.on('pong', handleLivenessNoop);

    wsClient.on('module_data_changed', handleModuleChange);
    wsClient.on('reminder', handleReminder);
    wsClient.on('task_completed', handleTaskCompleted);
    wsClient.on('task_failed', handleTaskFailed);
    wsClient.on('task_progress', handleTaskProgress);
    wsClient.on('stream_start', handleStreamStart);
    wsClient.on('stream_chunk', handleStreamChunk);
    wsClient.on('stream_end', handleStreamEnd);
    wsClient.on('stream_error', handleStreamError);
    wsClient.on('stream_aborted', handleStreamAborted);
    wsClient.on('conversation_updated', handleConversationUpdated);

    return () => {
      unsubStatus();
      wsClient.off('tick', handleLivenessNoop);
      wsClient.off('heartbeat', handleLivenessNoop);
      wsClient.off('pong', handleLivenessNoop);
      wsClient.off('module_data_changed', handleModuleChange);
      wsClient.off('reminder', handleReminder);
      wsClient.off('task_completed', handleTaskCompleted);
      wsClient.off('task_failed', handleTaskFailed);
      wsClient.off('task_progress', handleTaskProgress);
      wsClient.off('stream_start', handleStreamStart);
      wsClient.off('stream_chunk', handleStreamChunk);
      wsClient.off('stream_end', handleStreamEnd);
      wsClient.off('stream_error', handleStreamError);
      wsClient.off('stream_aborted', handleStreamAborted);
      wsClient.off('conversation_updated', handleConversationUpdated);
      wsClient.onDisconnect = null;
      wsClient.disconnect();
    };
  }, [serverUrl, token, queryClient]);
}
