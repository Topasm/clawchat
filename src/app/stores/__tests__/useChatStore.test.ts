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
      connectionStatus: 'disconnected',
    });
    // Reset chat store to demo
    useChatStore.getState().resetToDemo();
  });

  describe('initial state', () => {
    it('starts with empty conversations', () => {
      const { conversations } = useChatStore.getState();
      expect(conversations).toHaveLength(0);
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
    it('clears conversations and messages', () => {
      // Mutate state
      useChatStore.setState({
        conversations: [{ id: 'test-1', title: 'Test', created_at: '', updated_at: '' }],
        messages: [{ _id: 'x', text: 'hi', createdAt: new Date(), user: { _id: 'user', name: 'You' } }],
        currentConversationId: 'some-id',
        conversationsLoaded: true,
      });

      useChatStore.getState().resetToDemo();

      const state = useChatStore.getState();
      expect(state.conversations).toHaveLength(0);
      expect(state.messages).toHaveLength(0);
      expect(state.currentConversationId).toBeNull();
      expect(state.conversationsLoaded).toBe(false);
      expect(state.taskProgress).toEqual({});
    });
  });

  describe('fetchConversations', () => {
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

  describe('fetchMessages', () => {
    it('fetches messages from server when logged in', async () => {
      const apiClient = (await import('../../services/apiClient')).default;
      const mockMessages = [
        { id: 'msg-1', content: 'Hello', role: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'msg-2', content: 'Hi there', role: 'assistant', created_at: '2026-01-01T00:01:00Z' },
      ];
      (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { items: mockMessages } });

      useAuthStore.setState({ serverUrl: 'http://localhost:3000', token: 'tok' });

      await useChatStore.getState().fetchMessages('conv-1');

      const { messages } = useChatStore.getState();
      expect(messages.length).toBe(2);
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
      useChatStore.setState({
        conversations: [
          { id: 'conv-1', title: 'A', created_at: '', updated_at: '' },
          { id: 'conv-2', title: 'B', created_at: '', updated_at: '' },
        ],
      });
      useChatStore.getState().removeConversation('conv-1');
      expect(useChatStore.getState().conversations.length).toBe(1);
      expect(useChatStore.getState().conversations[0].id).toBe('conv-2');
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
