import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore } from '../useChatStore';
import { useAuthStore } from '../useAuthStore';

// Mock apiClient
vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  },
}));

// Mock SSE client
vi.mock('../../services/sseClient', () => ({
  connectSSE: vi.fn(),
}));

// Mock secure storage
vi.mock('../../services/platform', () => ({
  secureStorage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('useChatStore', () => {
  beforeEach(() => {
    // Reset auth to demo mode
    useAuthStore.setState({
      token: null,
      refreshToken: null,
      serverUrl: null,
      isLoading: false,
      connectionStatus: 'demo',
    });
    // Reset chat store to demo
    useChatStore.getState().resetToDemo();
  });

  describe('demo data seeding', () => {
    it('starts with demo conversations', () => {
      const { conversations } = useChatStore.getState();
      expect(conversations.length).toBe(2);
      expect(conversations[0].id).toMatch(/^demo-conv-/);
    });

    it('starts with empty messages', () => {
      const { messages } = useChatStore.getState();
      expect(messages).toHaveLength(0);
    });

    it('conversationsLoaded starts as false', () => {
      expect(useChatStore.getState().conversationsLoaded).toBe(false);
    });
  });

  describe('resetToDemo', () => {
    it('restores demo conversations and clears messages', () => {
      // Mutate state
      useChatStore.setState({
        conversations: [],
        messages: [{ _id: 'x', text: 'hi', createdAt: new Date(), user: { _id: 'user', name: 'You' } }],
        currentConversationId: 'some-id',
        conversationsLoaded: true,
      });

      useChatStore.getState().resetToDemo();

      const state = useChatStore.getState();
      expect(state.conversations.length).toBe(2);
      expect(state.conversations[0].id).toMatch(/^demo-conv-/);
      expect(state.messages).toHaveLength(0);
      expect(state.currentConversationId).toBeNull();
      expect(state.conversationsLoaded).toBe(false);
      expect(state.taskProgress).toEqual({});
    });
  });

  describe('fetchConversations', () => {
    it('seeds demo conversations in demo mode', async () => {
      await useChatStore.getState().fetchConversations();
      const state = useChatStore.getState();
      expect(state.conversations.length).toBe(2);
      expect(state.conversationsLoaded).toBe(true);
    });

    it('fetches from server when logged in', async () => {
      const apiClient = (await import('../../services/apiClient')).default;
      const mockConvos = [{ id: 'srv-conv-1', title: 'Server Convo', created_at: '', updated_at: '' }];
      (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { items: mockConvos } });

      useAuthStore.setState({ serverUrl: 'http://localhost:3000', token: 'tok' });

      await useChatStore.getState().fetchConversations();

      const state = useChatStore.getState();
      expect(state.conversations).toEqual(mockConvos);
      expect(state.conversationsLoaded).toBe(true);
    });
  });

  describe('fetchMessages — demo mode', () => {
    it('loads demo messages for known conversation', async () => {
      await useChatStore.getState().fetchMessages('demo-conv-1');
      const { messages } = useChatStore.getState();
      expect(messages.length).toBe(2);
      expect(messages[0]._id).toMatch(/^demo-msg-/);
    });

    it('loads empty for unknown conversation', async () => {
      await useChatStore.getState().fetchMessages('unknown');
      expect(useChatStore.getState().messages).toHaveLength(0);
    });
  });

  describe('sendMessageStreaming — demo mode', () => {
    it('appends a demo response message', async () => {
      useChatStore.setState({ messages: [] });
      await useChatStore.getState().sendMessageStreaming('demo-conv-1', 'Hello');
      const { messages } = useChatStore.getState();
      expect(messages.length).toBe(1);
      expect(messages[0].user._id).toBe('assistant');
      expect(messages[0].text).toContain('demo');
    });
  });

  describe('message operations', () => {
    it('addMessage prepends a message', () => {
      const msg = { _id: 'new-1', text: 'hello', createdAt: new Date(), user: { _id: 'user', name: 'You' } };
      useChatStore.getState().addMessage(msg);
      expect(useChatStore.getState().messages[0]._id).toBe('new-1');
    });

    it('appendToLastMessage appends text', () => {
      const msg = { _id: 'x', text: 'hello', createdAt: new Date(), user: { _id: 'assistant', name: 'Bot' } };
      useChatStore.setState({ messages: [msg] });
      useChatStore.getState().appendToLastMessage(' world');
      expect(useChatStore.getState().messages[0].text).toBe('hello world');
    });

    it('addConversation prepends a conversation', () => {
      const conv = { id: 'new-conv', title: 'Test', created_at: '', updated_at: '' };
      useChatStore.getState().addConversation(conv);
      expect(useChatStore.getState().conversations[0].id).toBe('new-conv');
    });

    it('removeConversation removes by id', () => {
      const initial = useChatStore.getState().conversations.length;
      useChatStore.getState().removeConversation('demo-conv-1');
      expect(useChatStore.getState().conversations.length).toBe(initial - 1);
    });
  });

  describe('updateTaskProgress', () => {
    it('merges progress data for a task', () => {
      useChatStore.getState().updateTaskProgress('task-1', { status: 'running', progress: 50 });
      expect(useChatStore.getState().taskProgress['task-1']).toEqual({ status: 'running', progress: 50 });

      useChatStore.getState().updateTaskProgress('task-1', { progress: 100 });
      expect(useChatStore.getState().taskProgress['task-1']).toEqual({ status: 'running', progress: 100 });
    });
  });
});
