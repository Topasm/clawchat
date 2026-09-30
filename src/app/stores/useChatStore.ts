import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useAuthStore } from './useAuthStore';
import { useToastStore } from './useToastStore';
import { connectSSE } from '../services/sseClient';
import apiClient from '../services/apiClient';
import { logger } from '../services/logger';
import type { StreamEventMeta } from '../types/api';
import { queryClient } from '../config/queryClient';
import { invalidateModuleQueries } from '../hooks/queries/invalidateModuleQueries';
import { translateUi } from '../i18n';
const MAX_MESSAGES = 500;
const chatSessionStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // Persistence is a recovery layer. In-memory chat must keep working if
      // storage is unavailable or full.
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // Best effort only.
    }
  },
}));
let pendingRunTimer: ReturnType<typeof setTimeout> | null = null;
function armPendingRunTimeout() {
  clearPendingRunTimeout();
  pendingRunTimer = setTimeout(() => {
    const { isStreaming } = useChatStore.getState();
    if (isStreaming) {
      useChatStore.getState().interruptStreaming();
      useToastStore
        .getState()
        .addToast('error', translateUi('Response timed out. Please try again.'));
    }
  }, 120000);
}
export function clearPendingRunTimeout() {
  if (pendingRunTimer) {
    clearTimeout(pendingRunTimer);
    pendingRunTimer = null;
  }
}
export interface TaskProgressData {
  /** AgentRun lifecycle value; `waiting_review` and `waiting_input` mean the user is up. */
  status?: string;
  progress?: number;
  message?: string;
  result?: string;
  error?: string;
  run_id?: string;
  review_id?: string;
  sub_tasks?: Array<{
    id: string;
    instruction: string;
    status: string;
    progress: number;
  }>;
}
export interface ChatMessage {
  _id: string;
  text: string;
  createdAt: Date;
  user: {
    _id: string;
    name: string;
  };
  metadata?: Record<string, unknown>;
  conversationId?: string;
  deliveryStatus?: 'pending' | 'accepted' | 'streaming' | 'failed' | 'interrupted';
  idempotencyKey?: string;
  workspaceScope?: string;
}

export function getChatWorkspaceScope(): string {
  const { hostId, serverUrl } = useAuthStore.getState();
  if (hostId?.trim()) return `host:${hostId.trim()}`;
  if (serverUrl?.trim()) return `server:${serverUrl.trim().replace(/\/+$/, '').toLowerCase()}`;
  return 'unscoped';
}

export function getChatDraftKey(conversationId: string | null | undefined): string {
  return `${getChatWorkspaceScope()}:${conversationId ?? 'new-conversation'}`;
}
function trimMessages(msgs: ChatMessage[]): ChatMessage[] {
  return msgs.length > MAX_MESSAGES ? msgs.slice(0, MAX_MESSAGES) : msgs;
}
/**
 * Remove duplicate messages that can appear when the same message arrives
 * via both a WebSocket event and a React Query refetch.  Uses a composite
 * key of `workspace | conversation | user | createdAt | text`.
 * Messages that lack enough data to build a key are always kept.
 */
function dedupeMessages(msgs: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return msgs.filter((msg) => {
    const userId = msg.user?._id;
    const timestamp =
      msg.createdAt instanceof Date ? msg.createdAt.toISOString() : String(msg.createdAt);
    const text = msg.text;
    // If we can't build a reliable key, keep the message as-is
    if (!userId || !timestamp || text == null) return true;
    const key = `${msg.workspaceScope ?? ''}|${msg.conversationId ?? ''}|${userId}|${timestamp}|${text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
interface ChatState {
  projectPlanSelections: Record<string, { view: 'outline' | 'flow'; taskId: string | null }>;
  setProjectPlanSelection: (
    projectId: string,
    selection: { view: 'outline' | 'flow'; taskId: string | null },
  ) => void;
  // Only optimistic and in-flight messages live here. Durable history remains
  // server-authoritative and reconciles these entries by server message id.
  streamingMessages: ChatMessage[];
  currentConversationId: string | null;
  isStreaming: boolean;
  streamingConversationId: string | null;
  streamAbortController: AbortController | null;
  taskProgress: Record<string, TaskProgressData>;
  drafts: Record<string, string>;
  activeConversationByWorkspace: Record<string, string>;
  activeConversationByProject: Record<
    string,
    { conversationId: string; kind: 'project' | 'task' | 'run' }
  >;
  rememberProjectConversation: (
    projectId: string,
    conversationId: string | null,
    kind?: 'project' | 'task' | 'run',
  ) => void;
  setCurrentConversationId: (id: string | null) => void;
  addStreamingMessage: (message: ChatMessage) => void;
  appendToMessage: (messageId: string, content: string) => void;
  finalizeStreamMessage: (
    messageId: string,
    fullContent: string,
    metadata?: Record<string, unknown>,
  ) => void;
  updateStreamingMessageId: (
    oldId: string,
    newId: string,
    deliveryStatus?: ChatMessage['deliveryStatus'],
  ) => void;
  setStreamingState: (streaming: boolean, conversationId?: string | null) => void;
  reconcileMessages: (conversationId: string, authoritativeIds: Set<string>) => void;
  markMessageFailed: (messageId: string) => void;
  interruptStreaming: () => void;
  setDraft: (conversationId: string, text: string) => void;
  updateTaskProgress: (taskId: string, data: Partial<TaskProgressData>) => void;
  resetToDemo: () => void;
  sendMessageStreaming: (
    conversationId: string,
    text: string,
    options?: { optimisticMessageId?: string; idempotencyKey?: string },
  ) => Promise<void>;
  clearStreamingState: () => void;
  stopGeneration: () => void;
}
export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      streamingMessages: [],
      currentConversationId: null,
      isStreaming: false,
      streamingConversationId: null,
      streamAbortController: null,
      taskProgress: {},
      drafts: {},
      activeConversationByWorkspace: {},
      projectPlanSelections: {},
      setProjectPlanSelection: (projectId, selection) =>
        set((state) => ({
          projectPlanSelections: {
            ...state.projectPlanSelections,
            [JSON.stringify([getChatWorkspaceScope(), projectId])]: selection,
          },
        })),
      activeConversationByProject: {},
      rememberProjectConversation: (projectId, conversationId, kind = 'project') =>
        set((state) => {
          const key = JSON.stringify([getChatWorkspaceScope(), projectId]);
          const saved = { ...state.activeConversationByProject };
          if (conversationId) saved[key] = { conversationId, kind };
          else delete saved[key];
          return { activeConversationByProject: saved };
        }),
      setCurrentConversationId: (id) =>
        set((state) => {
          const scope = getChatWorkspaceScope();
          const activeConversationByWorkspace = { ...state.activeConversationByWorkspace };
          if (id) activeConversationByWorkspace[scope] = id;
          else delete activeConversationByWorkspace[scope];
          return { currentConversationId: id, activeConversationByWorkspace };
        }),
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
      updateStreamingMessageId: (oldId, newId, deliveryStatus) =>
        set((state) => ({
          streamingMessages: state.streamingMessages.map((m) =>
            m._id === oldId
              ? { ...m, _id: newId, deliveryStatus: deliveryStatus ?? m.deliveryStatus }
              : m,
          ),
        })),
      setStreamingState: (streaming, conversationId) =>
        set((state) => ({
          isStreaming: streaming,
          streamingConversationId: streaming
            ? (conversationId ?? state.currentConversationId)
            : null,
        })),
      reconcileMessages: (conversationId, authoritativeIds) =>
        set((state) => ({
          streamingMessages: state.streamingMessages.filter(
            (message) =>
              message.conversationId !== conversationId || !authoritativeIds.has(message._id),
          ),
        })),
      markMessageFailed: (messageId) =>
        set((state) => ({
          streamingMessages: state.streamingMessages.map((message) =>
            message._id === messageId ? { ...message, deliveryStatus: 'failed' } : message,
          ),
        })),
      interruptStreaming: () =>
        set((state) => ({
          streamingMessages: state.streamingMessages
            .filter((message) => message.deliveryStatus !== undefined)
            .map((message) =>
              message.deliveryStatus === 'streaming'
                ? { ...message, deliveryStatus: 'interrupted' }
                : message,
            ),
          isStreaming: false,
          streamingConversationId: null,
          streamAbortController: null,
        })),
      setDraft: (conversationId, text) =>
        set((state) => {
          if (!text) {
            const drafts = { ...state.drafts };
            delete drafts[conversationId];
            return { drafts };
          }
          return { drafts: { ...state.drafts, [conversationId]: text } };
        }),
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
          streamingConversationId: null,
          streamAbortController: null,
          taskProgress: {},
          drafts: {},
          activeConversationByWorkspace: {},
          projectPlanSelections: {},
          activeConversationByProject: {},
        }),
      // --- Streaming ---
      sendMessageStreaming: async (conversationId, text, options = {}) => {
        const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
        const optimisticMessageId = options.optimisticMessageId;
        const { serverUrl, token, connectionStatus, healthOK } = useAuthStore.getState();
        if (!healthOK) {
          useToastStore
            .getState()
            .addToast('warning', translateUi('Server status looks uncertain. Trying anyway...'));
        }
        // Orchestrator path: POST /send when WebSocket is connected
        // Response arrives via WS stream_start/chunk/end events (handled in useWebSocket)
        if (connectionStatus === 'connected') {
          try {
            get().setStreamingState(true, conversationId);
            armPendingRunTimeout();
            const response = await apiClient.post('/chat/send', {
              conversation_id: conversationId,
              content: text,
              idempotency_key: idempotencyKey,
            });
            if (optimisticMessageId && typeof response.data?.message_id === 'string') {
              get().updateStreamingMessageId(
                optimisticMessageId,
                response.data.message_id,
                'accepted',
              );
            }
            // Server returns 202 — assistant response will arrive via WebSocket events
            return;
          } catch (err) {
            logger.warn('Orchestrator /send failed, falling back to SSE:', err);
            get().setStreamingState(false, conversationId);
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
            conversationId,
            deliveryStatus: 'streaming',
            workspaceScope: getChatWorkspaceScope(),
          };
          set((state) => ({
            streamingMessages: [assistantMessage, ...state.streamingMessages],
            isStreaming: true,
            streamingConversationId: conversationId,
          }));
          armPendingRunTimeout();
          const abortController = connectSSE(
            url,
            { conversation_id: conversationId, content: text, idempotency_key: idempotencyKey },
            token ?? '',
            {
              onMeta: (meta: StreamEventMeta) => {
                streamingMessageId = meta.message_id;
                if (optimisticMessageId && meta.user_message_id) {
                  get().updateStreamingMessageId(
                    optimisticMessageId,
                    meta.user_message_id,
                    'accepted',
                  );
                }
                set((state) => {
                  const updated = state.streamingMessages.map((msg) =>
                    msg._id === assistantPlaceholderId
                      ? { ...msg, _id: meta.message_id, deliveryStatus: 'streaming' as const }
                      : msg,
                  );
                  return { streamingMessages: updated };
                });
              },
              onToken: (tokenText: string) => {
                const targetId = streamingMessageId ?? assistantPlaceholderId;
                set((state) => ({
                  streamingMessages: state.streamingMessages.map((msg) =>
                    msg._id === targetId ? { ...msg, text: msg.text + tokenText } : msg,
                  ),
                }));
              },
              onTitleGenerated: (_title: string) => {
                // Title updates will be handled by query invalidation after stream completes
              },
              onModuleDataChanged: (metadata) => {
                // The stream performed a task or calendar action. On the WebSocket
                // path the server pushes module_data_changed for this; on SSE it
                // rides along with the response, and the caches still need it.
                invalidateModuleQueries(queryClient, metadata?.module);
              },
              onDone: () => {
                clearPendingRunTimeout();
                set((state) => ({
                  streamingMessages: state.streamingMessages.map((message) =>
                    message._id === (streamingMessageId ?? assistantPlaceholderId)
                      ? { ...message, deliveryStatus: 'accepted' }
                      : message,
                  ),
                  isStreaming: false,
                  streamingConversationId: null,
                  streamAbortController: null,
                }));
                void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
                void queryClient.invalidateQueries({ queryKey: ['conversations'] });
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
                  streamingConversationId: null,
                  streamAbortController: null,
                }));
                if (optimisticMessageId) get().markMessageFailed(optimisticMessageId);
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
        get().interruptStreaming();
      },
      stopGeneration: () => {
        clearPendingRunTimeout();
        const { streamAbortController } = get();
        if (streamAbortController) {
          streamAbortController.abort();
        }
        get().interruptStreaming();
      },
    }),
    {
      name: 'chat-session-storage:v1',
      storage: chatSessionStorage,
      partialize: (state) => ({
        currentConversationId: state.currentConversationId,
        streamingMessages: state.streamingMessages.filter(
          (message) => message.deliveryStatus !== undefined,
        ),
        drafts: state.drafts,
        activeConversationByWorkspace: state.activeConversationByWorkspace,
        projectPlanSelections: state.projectPlanSelections,
        activeConversationByProject: state.activeConversationByProject,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<ChatState>;
        return {
          ...current,
          currentConversationId: saved.currentConversationId ?? null,
          drafts: saved.drafts ?? {},
          activeConversationByWorkspace: saved.activeConversationByWorkspace ?? {},
          projectPlanSelections: saved.projectPlanSelections ?? {},
          activeConversationByProject: saved.activeConversationByProject ?? {},
          streamingMessages: (saved.streamingMessages ?? []).map((message) => ({
            ...message,
            createdAt: new Date(message.createdAt),
            deliveryStatus:
              message.deliveryStatus === 'streaming' ? 'interrupted' : message.deliveryStatus,
          })),
          isStreaming: false,
          streamingConversationId: null,
          streamAbortController: null,
        };
      },
    },
  ),
);
