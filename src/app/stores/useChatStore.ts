import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { useToastStore } from './useToastStore';
import { connectSSE } from '../services/sseClient';
import apiClient from '../services/apiClient';
import { logger } from '../services/logger';
import type { StreamEventMeta } from '../types/api';

const MAX_MESSAGES = 500;

let pendingRunTimer: ReturnType<typeof setTimeout> | null = null;

function armPendingRunTimeout() {
  clearPendingRunTimeout();
  pendingRunTimer = setTimeout(() => {
    const { isStreaming } = useChatStore.getState();
    if (isStreaming) {
      useChatStore.setState({
        isStreaming: false,
        streamAbortController: null,
      });
      useToastStore.getState().addToast('error', 'Response timed out. Please try again.');
    }
  }, 120_000);
}

export function clearPendingRunTimeout() {
  if (pendingRunTimer) {
    clearTimeout(pendingRunTimer);
    pendingRunTimer = null;
  }
}

export interface TaskProgressData {
  status?: string;
  progress?: number;
  message?: string;
  result?: string;
  error?: string;
  sub_tasks?: Array<{ id: string; instruction: string; status: string; progress: number }>;
}

export interface ChatMessage {
  _id: string;
  text: string;
  createdAt: Date;
  user: { _id: string; name: string };
  metadata?: Record<string, unknown>;
}

function trimMessages(msgs: ChatMessage[]): ChatMessage[] {
  return msgs.length > MAX_MESSAGES ? msgs.slice(0, MAX_MESSAGES) : msgs;
}

/**
 * Remove duplicate messages that can appear when the same message arrives
 * via both a WebSocket event and a React Query refetch.  Uses a composite
 * key of `user._id | createdAt | text` (content-based fingerprint).
 * Messages that lack enough data to build a key are always kept.
 */
function dedupeMessages(msgs: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return msgs.filter((msg) => {
    const userId = msg.user?._id;
    const timestamp = msg.createdAt instanceof Date ? msg.createdAt.toISOString() : String(msg.createdAt);
    const text = msg.text;

    // If we can't build a reliable key, keep the message as-is
    if (!userId || !timestamp || text == null) return true;

    const key = `${userId}|${timestamp}|${text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface ChatState {
  // Streaming messages are ephemeral UI state — they live here until finalized
  streamingMessages: ChatMessage[];
  currentConversationId: string | null;
  isStreaming: boolean;
  streamAbortController: AbortController | null;
  taskProgress: Record<string, TaskProgressData>;

  setCurrentConversationId: (id: string | null) => void;
  addStreamingMessage: (message: ChatMessage) => void;
  appendToMessage: (messageId: string, content: string) => void;
  finalizeStreamMessage: (messageId: string, fullContent: string, metadata?: Record<string, unknown>) => void;
  clearStreamingMessages: () => void;
  updateStreamingMessageId: (oldId: string, newId: string) => void;
  setStreamingState: (streaming: boolean) => void;
  updateTaskProgress: (taskId: string, data: Partial<TaskProgressData>) => void;

  resetToDemo: () => void;

  sendMessageStreaming: (conversationId: string, text: string) => Promise<void>;
  clearStreamingState: () => void;
  stopGeneration: () => void;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  streamingMessages: [],
  currentConversationId: null,
  isStreaming: false,
  streamAbortController: null,
  taskProgress: {},

  setCurrentConversationId: (id) => set({ currentConversationId: id }),

  addStreamingMessage: (message) =>
    set((state) => ({
      streamingMessages: trimMessages(dedupeMessages([message, ...state.streamingMessages])),
    })),

  appendToMessage: (messageId, content) =>
    set((state) => ({
      streamingMessages: state.streamingMessages.map((m) =>
        m._id === messageId ? { ...m, text: m.text + content } : m,
      ),
    })),

  finalizeStreamMessage: (messageId, fullContent, metadata) =>
    set((state) => ({
      streamingMessages: state.streamingMessages.map((m) =>
        m._id === messageId ? { ...m, text: fullContent, metadata } : m,
      ),
    })),

  clearStreamingMessages: () => set({ streamingMessages: [] }),

  updateStreamingMessageId: (oldId, newId) =>
    set((state) => ({
      streamingMessages: state.streamingMessages.map((m) =>
        m._id === oldId ? { ...m, _id: newId } : m,
      ),
    })),

  setStreamingState: (streaming) => set({ isStreaming: streaming }),

  updateTaskProgress: (taskId, data) =>
    set((state) => ({
      taskProgress: {
        ...state.taskProgress,
        [taskId]: { ...state.taskProgress[taskId], ...data },
      },
    })),

  resetToDemo: () =>
    set({
      streamingMessages: [],
      currentConversationId: null,
      isStreaming: false,
      streamAbortController: null,
      taskProgress: {},
    }),

  // --- Streaming ---

  sendMessageStreaming: async (conversationId, text) => {
    const idempotencyKey = crypto.randomUUID();
    const { serverUrl, token, connectionStatus, healthOK } = useAuthStore.getState();
    if (!healthOK) {
      useToastStore.getState().addToast('warning', 'Server status looks uncertain. Trying anyway...');
    }

    // Orchestrator path: POST /send when WebSocket is connected
    // Response arrives via WS stream_start/chunk/end events (handled in useWebSocket)
    if (connectionStatus === 'connected') {
      try {
        set({ isStreaming: true });
        armPendingRunTimeout();
        await apiClient.post('/chat/send', {
          conversation_id: conversationId,
          content: text,
          idempotency_key: idempotencyKey,
        });
        // Server returns 202 — assistant response will arrive via WebSocket events
        return;
      } catch (err) {
        logger.warn('Orchestrator /send failed, falling back to SSE:', err);
        set({ isStreaming: false });
        // Fall through to SSE fallback
      }
    }

    // Fallback: SSE streaming via /stream
    return new Promise<void>((resolve, reject) => {
      const url = `${serverUrl}/api/chat/stream`;

      const assistantPlaceholderId = `streaming-${Date.now()}`;
      let streamingMessageId: string | null = null;
      const assistantMessage: ChatMessage = {
        _id: assistantPlaceholderId,
        text: '',
        createdAt: new Date(),
        user: { _id: 'assistant', name: 'ClawChat' },
      };

      set((state) => ({
        streamingMessages: [assistantMessage, ...state.streamingMessages],
        isStreaming: true,
      }));
      armPendingRunTimeout();

      const abortController = connectSSE(
        url,
        { conversation_id: conversationId, content: text, idempotency_key: idempotencyKey },
        token ?? '',
        {
          onMeta: (meta: StreamEventMeta) => {
            streamingMessageId = meta.message_id;
            set((state) => {
              const updated = state.streamingMessages.map((msg) =>
                msg._id === assistantPlaceholderId
                  ? { ...msg, _id: meta.message_id }
                  : msg,
              );
              return { streamingMessages: updated };
            });
          },
          onToken: (tokenText: string) => {
            const targetId = streamingMessageId ?? assistantPlaceholderId;
            set((state) => ({
              streamingMessages: state.streamingMessages.map((msg) =>
                msg._id === targetId
                  ? { ...msg, text: msg.text + tokenText }
                  : msg,
              ),
            }));
          },
          onTitleGenerated: (_title: string) => {
            // Title updates will be handled by query invalidation after stream completes
          },
          onDone: () => {
            clearPendingRunTimeout();
            set({ isStreaming: false, streamAbortController: null });
            resolve();
          },
          onError: (error: Error) => {
            clearPendingRunTimeout();
            const targetId = streamingMessageId ?? assistantPlaceholderId;
            set((state) => ({
              streamingMessages: state.streamingMessages.map((msg) =>
                msg._id === targetId && !msg.text
                  ? { ...msg, text: 'Sorry, an error occurred while generating a response.' }
                  : msg,
              ),
              isStreaming: false,
              streamAbortController: null,
            }));
            reject(error);
          },
        },
      );

      set({ streamAbortController: abortController });
    });
  },

  clearStreamingState: () => {
    const { streamAbortController } = get();
    if (streamAbortController) {
      streamAbortController.abort();
    }
    set({ isStreaming: false, streamAbortController: null, streamingMessages: [] });
  },

  stopGeneration: () => {
    clearPendingRunTimeout();
    const { streamAbortController } = get();
    if (streamAbortController) {
      streamAbortController.abort();
      set({ isStreaming: false, streamAbortController: null });
    }
  },
}));
