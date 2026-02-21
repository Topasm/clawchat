import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { connectSSE } from '../services/sseClient';
import apiClient from '../services/apiClient';
import type { ConversationResponse, StreamEventMeta } from '../types/api';

export interface ChatMessage {
  _id: string;
  text: string;
  createdAt: Date;
  user: { _id: string; name: string };
}

interface ChatState {
  conversations: ConversationResponse[];
  messages: ChatMessage[];
  currentConversationId: string | null;
  isStreaming: boolean;
  streamAbortController: AbortController | null;

  setConversations: (conversations: ConversationResponse[]) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setCurrentConversationId: (id: string | null) => void;
  addMessage: (message: ChatMessage) => void;
  appendToLastMessage: (content: string) => void;
  addConversation: (conversation: ConversationResponse) => void;

  sendMessageStreaming: (conversationId: string, text: string) => Promise<void>;
  stopGeneration: () => void;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  regenerateMessage: (conversationId: string, assistantMessageId: string) => string | null;
  editMessage: (conversationId: string, messageId: string, newText: string) => Promise<string | null>;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  conversations: [],
  messages: [],
  currentConversationId: null,
  isStreaming: false,
  streamAbortController: null,

  setConversations: (conversations) => set({ conversations }),
  setMessages: (messages) => set({ messages }),
  setCurrentConversationId: (id) => set({ currentConversationId: id }),

  addMessage: (message) =>
    set((state) => ({
      messages: [message, ...state.messages],
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

  sendMessageStreaming: (conversationId, text) => {
    return new Promise<void>((resolve, reject) => {
      const { serverUrl, token } = useAuthStore.getState();
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
    set((state) => ({
      messages: state.messages.filter((m) => m._id !== messageId),
    }));
    try {
      await apiClient.delete(`/chat/conversations/${conversationId}/messages/${messageId}`);
    } catch (error) {
      console.warn('Failed to delete message on server:', error);
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

    apiClient
      .delete(`/chat/conversations/${conversationId}/messages/${assistantMessageId}`)
      .catch((err) => console.warn('Failed to delete assistant message on server:', err));

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
      for (const id of assistantMessagesToRemove) {
        apiClient
          .delete(`/chat/conversations/${conversationId}/messages/${id}`)
          .catch((err) => console.warn('Failed to delete old assistant message:', err));
      }
    }

    try {
      await apiClient.put(`/chat/conversations/${conversationId}/messages/${messageId}`, { content: newText });
    } catch (error) {
      console.warn('Failed to edit message on server:', error);
    }

    return newText;
  },
}));
