import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { wsClient } from '../services/wsClient';
import { useAuthStore } from '../stores/useAuthStore';
import {
  getChatWorkspaceScope,
  useChatStore,
  clearPendingRunTimeout,
  type ChatMessage,
} from '../stores/useChatStore';
import { useToastStore } from '../stores/useToastStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { notify } from '../services/platform';
import { playReminderSound } from '../services/reminderSound';
import { platformApi } from '../platform';
import { IS_DESKTOP } from '../types/platform';
import apiClient from '../services/apiClient';
import { refreshAuthSession } from '../services/sessionRefresh';
import { logger } from '../services/logger';
import { queryKeys } from './queries';
import type { ConversationResponse } from '../types/api';
import { invalidateTaskDerivedQueries } from './queries/invalidateTaskDerivedQueries';
import { invalidateModuleQueries } from './queries/invalidateModuleQueries';
import { translateUi } from '../i18n';
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
    const invalidateExecutionTelemetry = () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskExecutionTelemetry });
    // Sync connection status to auth store
    const unsubStatus = wsClient.onStatusChange((status) => {
      useAuthStore.getState().setConnectionStatus(status);
      // Events are intentionally ephemeral. After either a direct or relay
      // reconnect, refresh authoritative server state to recover anything
      // emitted while the client was offline.
      if (status === 'connected') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.todos });
        void queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
        void invalidateTaskDerivedQueries(queryClient);
        void queryClient.invalidateQueries({ queryKey: queryKeys.planProposals });
        void queryClient.invalidateQueries({ queryKey: queryKeys.events });
        void queryClient.invalidateQueries({ queryKey: queryKeys.today });
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
        void queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
        void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
        void queryClient.invalidateQueries({ queryKey: ['runs'] });
        invalidateExecutionTelemetry();
        const conversationId = useChatStore.getState().currentConversationId;
        if (conversationId) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
        }
      }
    });
    let disposed = false;
    let authRecoveryInFlight = false;
    // A restored access token may have expired while the app was closed. The
    // refresh token is remembered in the OS credential vault, so recover it
    // before treating the session as signed out and asking for the PIN again.
    wsClient.onAuthFailure = () => {
      if (authRecoveryInFlight) return;
      authRecoveryInFlight = true;
      void refreshAuthSession()
        .catch((error) => {
          logger.warn('Could not restore the remembered real-time session', error);
          if (!disposed) {
            useToastStore
              .getState()
              .addToast('error', translateUi('Session expired. Please log in again.'));
          }
        })
        .finally(() => {
          authRecoveryInFlight = false;
        });
    };
    // Fail pending streaming state on disconnect so the UI doesn't get stuck
    wsClient.onDisconnect = () => {
      const { isStreaming, clearStreamingState } = useChatStore.getState();
      if (isStreaming) {
        clearStreamingState();
        useToastStore
          .getState()
          .addToast('error', translateUi('Connection lost during response. Reconnecting...'));
      }
    };
    const handleModuleChange = (data: unknown) => {
      invalidateModuleQueries(
        queryClient,
        (
          data as {
            module?: string;
          }
        ).module,
      );
    };
    const handleReminder = (data: unknown) => {
      const d = data as {
        title?: string;
        message?: string;
        item_type?: 'todo' | 'event';
        item_id?: string;
      };
      const message = d.message ?? `Reminder: ${d.title ?? 'Upcoming event'}`;
      useToastStore.getState().addToast('warning', message, { duration: 10000 });
      const settings = useSettingsStore.getState();
      if (settings.notificationsEnabled) {
        if (settings.reminderSound) playReminderSound();
        void notify('Reminder', message, {
          silent: !settings.reminderSound,
          itemType: d.item_type,
          itemId: d.item_id,
        });
      }
    };
    // task_completed / task_failed carry the chat card's payload (full result,
    // error). Whether the run is done, waiting for review or waiting for input
    // is the run's call, so the status comes from `run_status` and the user is
    // told by `run_state_changed` -- never here, or a result that still needs
    // approval would be announced as finished.
    const handleTaskCompleted = (data: unknown) => {
      const d = data as {
        task_id?: string;
        result?: string;
        run_id?: string | null;
        run_status?: string | null;
      };
      useChatStore.getState().updateTaskProgress?.(d.task_id ?? '', {
        status: d.run_status ?? 'completed',
        result: d.result,
        run_id: d.run_id ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      invalidateExecutionTelemetry();
    };
    const handleTaskFailed = (data: unknown) => {
      const d = data as {
        task_id?: string;
        error?: string;
        run_id?: string | null;
      };
      useChatStore.getState().updateTaskProgress?.(d.task_id ?? '', {
        status: 'failed',
        error: d.error,
        run_id: d.run_id ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      invalidateExecutionTelemetry();
    };
    const handleRunStateChanged = (data: unknown) => {
      const d = data as {
        run_id?: string;
        agent_task_id?: string;
        todo_id?: string | null;
        parent_task_id?: string | null;
        title?: string | null;
        status?: string;
        progress_message?: string | null;
        result_summary?: string | null;
        error?: string | null;
        review_id?: string | null;
      };
      if (d.agent_task_id) {
        useChatStore.getState().updateTaskProgress?.(d.agent_task_id, {
          status: d.status,
          message: d.progress_message ?? undefined,
          result: d.result_summary ?? undefined,
          error: d.error ?? undefined,
          run_id: d.run_id,
          review_id: d.review_id ?? undefined,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      invalidateExecutionTelemetry();
      // Sub-task runs report through their parent; only top-level runs get a voice.
      if (d.parent_task_id) return;
      const title = d.title || translateUi('Agent run');
      const announce = (
        type: 'warning' | 'info' | 'error',
        message: string,
        heading: string,
        duration: number,
      ) => {
        useToastStore.getState().addToast(type, message, { duration });
        if (useSettingsStore.getState().notificationsEnabled) {
          void notify(heading, message, { itemType: 'todo', itemId: d.todo_id ?? undefined });
        }
      };
      if (d.status === 'waiting_input') {
        announce(
          'warning',
          translateUi('Agent needs your input: {{title}}', { title }),
          translateUi('Agent needs input'),
          15000,
        );
      } else if (d.status === 'waiting_review') {
        announce(
          'info',
          translateUi('Ready for your review: {{title}}', { title }),
          translateUi('Ready for review'),
          10000,
        );
      } else if (d.status === 'failed') {
        announce(
          'error',
          translateUi('Agent run failed: {{error}}', { error: d.error ?? title }),
          translateUi('Agent run failed'),
          10000,
        );
      }
    };
    const handleTaskProgress = (data: unknown) => {
      const d = data as {
        task_id?: string;
        progress?: number;
        message?: string;
        status?: string;
      };
      const chatStore = useChatStore.getState();
      chatStore.updateTaskProgress?.(d.task_id ?? '', d);
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      invalidateExecutionTelemetry();
    };
    // --- AI stream events (from orchestrator /send path) ---
    const handleStreamStart = (data: unknown) => {
      const d = data as {
        message_id: string;
        conversation_id: string;
      };
      const chatStore = useChatStore.getState();
      const placeholder: ChatMessage = {
        _id: d.message_id,
        text: '',
        createdAt: new Date(),
        user: { _id: 'assistant', name: 'ClawChat' },
        conversationId: d.conversation_id,
        deliveryStatus: 'streaming',
        workspaceScope: getChatWorkspaceScope(),
      };
      chatStore.addStreamingMessage(placeholder);
      chatStore.setStreamingState(true, d.conversation_id);
    };
    const handleStreamChunk = (data: unknown) => {
      const d = data as {
        message_id: string;
        content: string;
      };
      useChatStore.getState().appendToMessage(d.message_id, d.content);
    };
    const handleStreamEnd = (data: unknown) => {
      const d = data as {
        message_id: string;
        full_content: string;
        metadata?: Record<string, unknown>;
        conversation_id?: string;
      };
      clearPendingRunTimeout();
      const chatStore = useChatStore.getState();
      chatStore.finalizeStreamMessage(d.message_id, d.full_content, d.metadata);
      chatStore.updateStreamingMessageId(d.message_id, d.message_id, 'accepted');
      chatStore.setStreamingState(false, d.conversation_id);
      // Invalidate messages query to pick up finalized message from server
      const conversationId = d.conversation_id || chatStore.currentConversationId;
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      }
    };
    const handleStreamError = (data: unknown) => {
      const d = data as {
        conversation_id?: string;
        error_message?: string;
        message?: string;
      };
      clearPendingRunTimeout();
      const conversationId = d.conversation_id || useChatStore.getState().currentConversationId;
      useChatStore.setState({
        isStreaming: false,
        streamingConversationId: null,
        streamAbortController: null,
      });
      const errorMsg =
        d.error_message || d.message || 'An error occurred while generating a response';
      useToastStore.getState().addToast('error', errorMsg);
      // Reload messages to get authoritative server state
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
      }
    };
    const handleStreamAborted = (data: unknown) => {
      const d = data as {
        conversation_id?: string;
      };
      clearPendingRunTimeout();
      const conversationId = d.conversation_id || useChatStore.getState().currentConversationId;
      useChatStore.setState({
        isStreaming: false,
        streamingConversationId: null,
        streamAbortController: null,
      });
      // Reload messages to get authoritative server state
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
      }
    };
    const handleConversationUpdated = (data: unknown) => {
      const d = data as {
        conversation_id: string;
        title?: string;
        message_id?: string;
      };
      if (d.message_id) {
        // The server wrote a message on its own (an agent run reporting into
        // its thread); the open conversation and the list order both moved.
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(d.conversation_id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      }
      if (d.title) {
        // Update conversation title in query cache
        queryClient.setQueryData<ConversationResponse[]>(queryKeys.conversations, (old) =>
          (old ?? []).map((c) => (c.id === d.conversation_id ? { ...c, title: d.title! } : c)),
        );
      }
    };
    // Desktop: handle "Mark Done" action from a native notification
    let unsubNotifAction: (() => void) | undefined;
    if (IS_DESKTOP) {
      unsubNotifAction = platformApi.events.on('notification:action', async (action) => {
        const d = action;
        if (d.action === 'mark_done' && d.itemId) {
          try {
            if (d.itemType === 'todo') {
              await apiClient.patch(`/todos/${d.itemId}`, { status: 'completed' });
              queryClient.invalidateQueries({ queryKey: queryKeys.todos });
              queryClient.invalidateQueries({ queryKey: queryKeys.today });
              void invalidateTaskDerivedQueries(queryClient);
            }
          } catch {
            // Best-effort
          }
        }
      });
    }
    const handleNudge = (data: unknown) => {
      const d = data as {
        title?: string;
        message?: string;
        todo_id?: string;
        suggested_action?: string;
      };
      const message = d.message ?? 'You have a task that needs attention';
      useToastStore.getState().addToast('info', message, { duration: 15000 });
      const settings = useSettingsStore.getState();
      if (settings.notificationsEnabled) {
        void notify('Nudge', message, { itemType: 'todo', itemId: d.todo_id });
      }
    };
    const handleWeeklyReview = (data: unknown) => {
      const d = data as {
        content?: string;
      };
      useToastStore
        .getState()
        .addToast('info', translateUi('Weekly review is ready! Check your chat.'), {
          duration: 15000,
        });
      const settings = useSettingsStore.getState();
      if (settings.notificationsEnabled) {
        void notify('Weekly Review', d.content?.slice(0, 100) ?? 'Your weekly review is ready');
      }
    };
    const handleDailyBriefing = (data: unknown) => {
      const d = data as {
        content?: string;
      };
      useToastStore
        .getState()
        .addToast('info', translateUi('Morning briefing is ready!'), { duration: 10000 });
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
      const settings = useSettingsStore.getState();
      if (settings.notificationsEnabled) {
        void notify('Daily Briefing', d.content?.slice(0, 100) ?? 'Your daily briefing is ready');
      }
    };
    // Server liveness signals — wsClient already tracked lastMessageTime; ignore here
    const handleLivenessNoop = () => {};
    wsClient.on('tick', handleLivenessNoop);
    wsClient.on('heartbeat', handleLivenessNoop);
    wsClient.on('pong', handleLivenessNoop);
    wsClient.on('module_data_changed', handleModuleChange);
    wsClient.on('reminder', handleReminder);
    wsClient.on('nudge', handleNudge);
    wsClient.on('weekly_review', handleWeeklyReview);
    wsClient.on('daily_briefing', handleDailyBriefing);
    wsClient.on('task_completed', handleTaskCompleted);
    wsClient.on('task_failed', handleTaskFailed);
    wsClient.on('task_progress', handleTaskProgress);
    wsClient.on('run_state_changed', handleRunStateChanged);
    wsClient.on('stream_start', handleStreamStart);
    wsClient.on('stream_chunk', handleStreamChunk);
    wsClient.on('stream_end', handleStreamEnd);
    wsClient.on('stream_error', handleStreamError);
    wsClient.on('stream_aborted', handleStreamAborted);
    wsClient.on('conversation_updated', handleConversationUpdated);
    return () => {
      disposed = true;
      unsubNotifAction?.();
      unsubStatus();
      wsClient.off('tick', handleLivenessNoop);
      wsClient.off('heartbeat', handleLivenessNoop);
      wsClient.off('pong', handleLivenessNoop);
      wsClient.off('module_data_changed', handleModuleChange);
      wsClient.off('reminder', handleReminder);
      wsClient.off('nudge', handleNudge);
      wsClient.off('weekly_review', handleWeeklyReview);
      wsClient.off('daily_briefing', handleDailyBriefing);
      wsClient.off('task_completed', handleTaskCompleted);
      wsClient.off('task_failed', handleTaskFailed);
      wsClient.off('task_progress', handleTaskProgress);
      wsClient.off('run_state_changed', handleRunStateChanged);
      wsClient.off('stream_start', handleStreamStart);
      wsClient.off('stream_chunk', handleStreamChunk);
      wsClient.off('stream_end', handleStreamEnd);
      wsClient.off('stream_error', handleStreamError);
      wsClient.off('stream_aborted', handleStreamAborted);
      wsClient.off('conversation_updated', handleConversationUpdated);
      wsClient.onAuthFailure = null;
      wsClient.onDisconnect = null;
      wsClient.disconnect();
    };
  }, [serverUrl, token, queryClient]);
}
