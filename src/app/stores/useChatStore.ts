import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { useToastStore } from './useToastStore';
import { connectSSE } from '../services/sseClient';
import apiClient from '../services/apiClient';
import { logger } from '../services/logger';
import type { ConversationResponse, StreamEventMeta } from '../types/api';

const MAX_MESSAGES = 500;

export interface ChatMessage {
  _id: string;
  text: string;
  createdAt: Date;
  user: { _id: string; name: string };
}

function trimMessages(msgs: ChatMessage[]): ChatMessage[] {
  return msgs.length > MAX_MESSAGES ? msgs.slice(0, MAX_MESSAGES) : msgs;
}

// Demo conversations shown when no server is configured
const DEMO_CONVERSATIONS: ConversationResponse[] = [
  {
    id: 'demo-conv-1',
    title: 'Project Architecture',
    last_message: 'Zustand is a great choice for state management in this project.',
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    updated_at: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    id: 'demo-conv-2',
    title: 'Deployment Strategy',
    last_message: 'Docker Compose with a reverse proxy is the recommended setup.',
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

const DEMO_MESSAGES: Record<string, ChatMessage[]> = {
  'demo-conv-1': [
    {
      _id: 'demo-msg-1a',
      text: 'Zustand is a great choice for state management in this project.',
      createdAt: new Date(Date.now() - 3_600_000),
      user: { _id: 'assistant', name: 'ClawChat' },
    },
    {
      _id: 'demo-msg-1b',
      text: 'What state management library should I use for this project?',
      createdAt: new Date(Date.now() - 3_601_000),
      user: { _id: 'user', name: 'You' },
    },
  ],
  'demo-conv-2': [
    {
      _id: 'demo-msg-2a',
      text: 'Docker Compose with a reverse proxy is the recommended setup.',
      createdAt: new Date(Date.now() - 86_400_000),
      user: { _id: 'assistant', name: 'ClawChat' },
    },
    {
      _id: 'demo-msg-2b',
      text: 'How should I deploy ClawChat?',
      createdAt: new Date(Date.now() - 86_401_000),
      user: { _id: 'user', name: 'You' },
    },
  ],
};

/** Helper: returns true when no server is configured (demo mode) */
function isDemoMode(): boolean {
  return !useAuthStore.getState().serverUrl;
}

interface ChatState {
  conversations: ConversationResponse[];
  messages: ChatMessage[];
  currentConversationId: string | null;
  isStreaming: boolean;
  streamAbortController: AbortController | null;
  conversationsLoaded: boolean;

  setConversations: (conversations: ConversationResponse[]) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setCurrentConversationId: (id: string | null) => void;
  addMessage: (message: ChatMessage) => void;
  appendToLastMessage: (content: string) => void;
  addConversation: (conversation: ConversationResponse) => void;
  removeConversation: (id: string) => void;

  fetchConversations: () => Promise<void>;
  createConversation: (title?: string) => Promise<ConversationResponse>;
  deleteConversation: (id: string) => Promise<void>;
  fetchMessages: (conversationId: string) => Promise<void>;

  sendMessageStreaming: (conversationId: string, text: string) => Promise<void>;
  stopGeneration: () => void;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  regenerateMessage: (conversationId: string, assistantMessageId: string) => string | null;
  editMessage: (conversationId: string, messageId: string, newText: string) => Promise<string | null>;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  conversations: DEMO_CONVERSATIONS,
  messages: [],
  currentConversationId: null,
  isStreaming: false,
  streamAbortController: null,
  conversationsLoaded: false,

  setConversations: (conversations) => set({ conversations }),
  setMessages: (messages) => set({ messages: trimMessages(messages) }),
  setCurrentConversationId: (id) => set({ currentConversationId: id }),

  addMessage: (message) =>
    set((state) => ({
      messages: trimMessages([message, ...state.messages]),
    })),

  appendToLastMessage: (content) =>
    set((state) => {
      const updated = [...state.messages];
      if (updated.length > 0) {
        updated[0] = { ...updated[0], text: updated[0].text + content };
      }
      return { messages: updated };
    }),

  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),

  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
    })),

  // --- Async conversation actions ---

  fetchConversations: async () => {
    if (isDemoMode()) {
      // Seed demo conversations if not already loaded
      if (!get().conversationsLoaded) {
        set({ conversations: DEMO_CONVERSATIONS, conversationsLoaded: true });
      }
      return;
    }
    try {
      const res = await apiClient.get('/chat/conversations');
      const items: ConversationResponse[] = res.data?.items ?? res.data ?? [];
      set({ conversations: items, conversationsLoaded: true });
    } catch (err) {
      logger.warn('Failed to fetch conversations:', err);
      // Keep existing data
    }
  },

  createConversation: async (title?: string) => {
    const convoTitle = title || 'New Conversation';

    if (isDemoMode()) {
      const localConvo: ConversationResponse = {
        id: `local-conv-${Date.now()}`,
        title: convoTitle,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      get().addConversation(localConvo);
      return localConvo;
    }

    try {
      const res = await apiClient.post('/chat/conversations', { title: convoTitle });
      const convo: ConversationResponse = res.data;
      get().addConversation(convo);
      return convo;
    } catch (err) {
      logger.warn('Failed to create conversation on server:', err);
      // Fall back to local creation
      const localConvo: ConversationResponse = {
        id: `local-conv-${Date.now()}`,
        title: convoTitle,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      get().addConversation(localConvo);
      useToastStore.getState().addToast('warning', 'Created locally, server sync failed');
      return localConvo;
    }
  },

  deleteConversation: async (id) => {
    const { conversations } = get();
    const existing = conversations.find((c) => c.id === id);
    // Optimistic remove
    get().removeConversation(id);
    useToastStore.getState().addToast('success', 'Conversation deleted');

    if (!isDemoMode()) {
      try {
        await apiClient.delete(`/chat/conversations/${id}`);
      } catch (err) {
        logger.warn('Failed to delete conversation on server:', err);
        if (existing) get().addConversation(existing);
        useToastStore.getState().addToast('error', 'Failed to delete conversation on server');
      }
    }
  },

  fetchMessages: async (conversationId) => {
    if (isDemoMode()) {
      const demoMsgs = DEMO_MESSAGES[conversationId] ?? [];
      set({ messages: demoMsgs });
      return;
    }
    try {
      const res = await apiClient.get(`/chat/conversations/${conversationId}/messages`);
      const rawMessages: Array<{ id: string; content: string; role: string; created_at: string }> =
        res.data?.items ?? res.data ?? [];
      const msgs: ChatMessage[] = rawMessages.map((m) => ({
        _id: m.id,
        text: m.content,
        createdAt: new Date(m.created_at),
        user: { _id: m.role, name: m.role === 'user' ? 'You' : 'ClawChat' },
      }));
      set({ messages: trimMessages(msgs.reverse()) });
    } catch (err) {
      logger.warn('Failed to fetch messages:', err);
      // Keep existing messages
    }
  },

  // --- Streaming / message actions ---

  sendMessageStreaming: (conversationId, text) => {
    return new Promise<void>((resolve, reject) => {
      const { serverUrl, token } = useAuthStore.getState();

      // In demo mode, simulate a response
      if (!serverUrl) {
        const assistantMessage: ChatMessage = {
          _id: `demo-reply-${Date.now()}`,
          text: 'This is a demo response. Connect to a server for real AI chat.',
          createdAt: new Date(),
          user: { _id: 'assistant', name: 'ClawChat' },
        };
        set((state) => ({
          messages: trimMessages([assistantMessage, ...state.messages]),
        }));
        resolve();
        return;
      }

      const url = `${serverUrl}/api/chat/stream`;

      const assistantPlaceholderId = `streaming-${Date.now()}`;
      const assistantMessage: ChatMessage = {
        _id: assistantPlaceholderId,
        text: '',
        createdAt: new Date(),
        user: { _id: 'assistant', name: 'ClawChat' },
      };

      set((state) => ({
        messages: [assistantMessage, ...state.messages],
        isStreaming: true,
      }));

      const abortController = connectSSE(
        url,
        { conversation_id: conversationId, content: text },
        token ?? '',
        {
          onMeta: (meta: StreamEventMeta) => {
            set((state) => {
              const updated = state.messages.map((msg) =>
                msg._id === assistantPlaceholderId
                  ? { ...msg, _id: meta.message_id }
                  : msg,
              );
              return { messages: updated };
            });
          },
          onToken: (tokenText: string) => {
            set((state) => {
              const updated = [...state.messages];
              if (updated.length > 0 && updated[0].user?._id === 'assistant') {
                updated[0] = { ...updated[0], text: updated[0].text + tokenText };
              }
              return { messages: updated };
            });
          },
          onDone: () => {
            set({ isStreaming: false, streamAbortController: null });
            resolve();
          },
          onError: (error: Error) => {
            set((state) => {
              const updated = [...state.messages];
              if (updated.length > 0 && updated[0].user?._id === 'assistant' && !updated[0].text) {
                updated[0] = { ...updated[0], text: 'Sorry, an error occurred while generating a response.' };
              }
              return { messages: updated, isStreaming: false, streamAbortController: null };
            });
            reject(error);
          },
        },
      );

      set({ streamAbortController: abortController });
    });
  },

  stopGeneration: () => {
    const { streamAbortController } = get();
    if (streamAbortController) {
      streamAbortController.abort();
      set({ isStreaming: false, streamAbortController: null });
    }
  },

  deleteMessage: async (conversationId, messageId) => {
    const { messages } = get();
    const deletedIndex = messages.findIndex((m) => m._id === messageId);
    const deletedMessage = deletedIndex !== -1 ? messages[deletedIndex] : null;

    set((state) => ({
      messages: state.messages.filter((m) => m._id !== messageId),
    }));

    if (!isDemoMode()) {
      try {
        await apiClient.delete(`/chat/conversations/${conversationId}/messages/${messageId}`);
      } catch (error) {
        logger.warn('Failed to delete message on server:', error);
        if (deletedMessage) {
          set((state) => {
            const updated = [...state.messages];
            // Re-insert at the original position (clamped to array bounds)
            const insertAt = Math.min(deletedIndex, updated.length);
            updated.splice(insertAt, 0, deletedMessage);
            return { messages: updated };
          });
        }
        useToastStore.getState().addToast('error', 'Failed to delete message on server');
      }
    }
  },

  regenerateMessage: (conversationId, assistantMessageId) => {
    const { messages } = get();
    const assistantIndex = messages.findIndex((m) => m._id === assistantMessageId);
    if (assistantIndex === -1) return null;

    let userMessage: ChatMessage | null = null;
    for (let i = assistantIndex + 1; i < messages.length; i++) {
      if (messages[i].user?._id === 'user') {
        userMessage = messages[i];
        break;
      }
    }
    if (!userMessage) return null;

    set((state) => ({
      messages: state.messages.filter((m) => m._id !== assistantMessageId),
    }));

    if (!isDemoMode()) {
      apiClient
        .delete(`/chat/conversations/${conversationId}/messages/${assistantMessageId}`)
        .catch((err) => logger.warn('Failed to delete assistant message on server:', err));
    }

    return userMessage.text;
  },

  editMessage: async (conversationId, messageId, newText) => {
    const { messages } = get();
    const msgIndex = messages.findIndex((m) => m._id === messageId);
    if (msgIndex === -1) return null;

    set((state) => {
      const updated = [...state.messages];
      updated[msgIndex] = { ...updated[msgIndex], text: newText };
      return { messages: updated };
    });

    const assistantMessagesToRemove: string[] = [];
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].user?._id === 'assistant') {
        assistantMessagesToRemove.push(messages[i]._id);
      } else {
        break;
      }
    }

    if (assistantMessagesToRemove.length > 0) {
      set((state) => ({
        messages: state.messages.filter((m) => !assistantMessagesToRemove.includes(m._id)),
      }));
      if (!isDemoMode()) {
        for (const id of assistantMessagesToRemove) {
          apiClient
            .delete(`/chat/conversations/${conversationId}/messages/${id}`)
            .catch((err) => logger.warn('Failed to delete old assistant message:', err));
        }
      }
    }

    if (!isDemoMode()) {
      try {
        await apiClient.put(`/chat/conversations/${conversationId}/messages/${messageId}`, { content: newText });
      } catch (error) {
        logger.warn('Failed to edit message on server:', error);
      }
    }

    return newText;
  },
}));
