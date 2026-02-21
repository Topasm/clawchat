import { create } from 'zustand';

export const useChatStore = create((set, get) => ({
  conversations: [],
  messages: [],
  currentConversationId: null,

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
}));
