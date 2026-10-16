import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushChatSessionStorage, useChatStore, type ChatMessage } from '../useChatStore';

function message(id: string, text = 'Hello'): ChatMessage {
  return {
    _id: id,
    text,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    user: { _id: 'assistant', name: 'ClawChat' },
  };
}

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.getState().resetToDemo();
    flushChatSessionStorage();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with empty ephemeral chat state', () => {
    const state = useChatStore.getState();

    expect(state.streamingMessages).toEqual([]);
    expect(state.currentConversationId).toBeNull();
    expect(state.isStreaming).toBe(false);
    expect(state.taskProgress).toEqual({});
  });

  it('adds, appends, and finalizes a streaming message', () => {
    const store = useChatStore.getState();
    store.addStreamingMessage(message('stream-1', 'Hel'));
    store.appendToMessage('stream-1', 'lo');
    store.finalizeStreamMessage('stream-1', 'Hello!', { model: 'test' });

    expect(useChatStore.getState().streamingMessages[0]).toMatchObject({
      _id: 'stream-1',
      text: 'Hello!',
      metadata: { model: 'test' },
    });
  });

  it('shows which tool the reply is using until its text arrives', () => {
    const store = useChatStore.getState();
    store.addStreamingMessage(message('stream-1', ''));
    store.setStreamingState(true, 'conv-1');
    store.setStreamingActivity({ tool: 'notes__search', label: 'search from notes' });
    expect(useChatStore.getState().streamingActivity?.label).toBe('search from notes');

    store.appendToMessage('stream-1', 'Found it');
    expect(useChatStore.getState().streamingActivity).toBeNull();

    store.setStreamingActivity({ tool: 'web_search', label: 'web search' });
    store.setStreamingState(false, 'conv-1');
    expect(useChatStore.getState().streamingActivity).toBeNull();
  });

  it('deduplicates messages with the same author, time, and content', () => {
    const store = useChatStore.getState();
    store.addStreamingMessage(message('stream-1'));
    store.addStreamingMessage(message('stream-2'));

    expect(useChatStore.getState().streamingMessages).toHaveLength(1);
  });

  it('updates a temporary streaming message id', () => {
    useChatStore.getState().addStreamingMessage(message('temporary'));
    useChatStore.getState().updateStreamingMessageId('temporary', 'server-id');

    expect(useChatStore.getState().streamingMessages[0]._id).toBe('server-id');
  });

  it('updates conversation and streaming state', () => {
    const store = useChatStore.getState();
    store.setCurrentConversationId('conversation-1');
    store.setStreamingState(true);

    expect(useChatStore.getState().currentConversationId).toBe('conversation-1');
    expect(useChatStore.getState().isStreaming).toBe(true);
  });

  it('keeps optimistic messages when the active conversation changes', () => {
    useChatStore.getState().addStreamingMessage({
      ...message('pending-user', 'Remember this'),
      conversationId: 'conversation-1',
      deliveryStatus: 'pending',
      user: { _id: 'user', name: 'You' },
    });

    useChatStore.getState().setCurrentConversationId('conversation-2');

    expect(useChatStore.getState().streamingMessages).toEqual([
      expect.objectContaining({ _id: 'pending-user', conversationId: 'conversation-1' }),
    ]);
  });

  it('reconciles only messages confirmed by the authoritative conversation', () => {
    const store = useChatStore.getState();
    store.addStreamingMessage({
      ...message('server-1'),
      conversationId: 'conversation-1',
      deliveryStatus: 'accepted',
    });
    store.addStreamingMessage({
      ...message('server-2'),
      conversationId: 'conversation-2',
      deliveryStatus: 'accepted',
    });

    store.reconcileMessages('conversation-1', new Set(['server-1']));

    expect(useChatStore.getState().streamingMessages.map((item) => item._id)).toEqual(['server-2']);
  });

  it('persists drafts and recoverable messages across rehydration', async () => {
    const store = useChatStore.getState();
    store.setCurrentConversationId('conversation-1');
    store.setDraft('conversation-1', 'unfinished prompt');
    store.addStreamingMessage({
      ...message('partial-assistant', 'Partial response'),
      conversationId: 'conversation-1',
      deliveryStatus: 'streaming',
    });
    flushChatSessionStorage();
    const persisted = localStorage.getItem('chat-session-storage:v1');
    expect(persisted).not.toBeNull();

    useChatStore.setState({
      currentConversationId: null,
      drafts: {},
      streamingMessages: [],
      isStreaming: false,
      streamingConversationId: null,
    });
    localStorage.setItem('chat-session-storage:v1', persisted!);
    await useChatStore.persist.rehydrate();

    expect(useChatStore.getState()).toMatchObject({
      currentConversationId: 'conversation-1',
      drafts: { 'conversation-1': 'unfinished prompt' },
      streamingMessages: [
        expect.objectContaining({
          _id: 'partial-assistant',
          deliveryStatus: 'interrupted',
        }),
      ],
      isStreaming: false,
    });
  });

  it('keeps in-memory recovery state when local storage writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => {
      useChatStore.getState().setDraft('conversation-1', 'still in memory');
      flushChatSessionStorage();
    }).not.toThrow();
    expect(useChatStore.getState().drafts['conversation-1']).toBe('still in memory');
  });

  it('writes streamed tokens to storage at most once a second', () => {
    vi.useFakeTimers();
    try {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const store = useChatStore.getState();
      store.addStreamingMessage({
        ...message('stream-1', ''),
        conversationId: 'conversation-1',
        deliveryStatus: 'streaming',
      });
      for (let i = 0; i < 50; i += 1) store.appendToMessage('stream-1', 'x');
      store.setDraft('conversation-1', 'typing');

      expect(setItem).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);

      expect(setItem).toHaveBeenCalledOnce();
      const saved = JSON.parse(localStorage.getItem('chat-session-storage:v1')!);
      expect(saved.state.streamingMessages[0].text).toBe('x'.repeat(50));
      expect(saved.state.drafts).toEqual({ 'conversation-1': 'typing' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes the pending snapshot when the page hides', () => {
    useChatStore.getState().setDraft('conversation-1', 'before close');
    expect(localStorage.getItem('chat-session-storage:v1')).toBeNull();

    window.dispatchEvent(new Event('pagehide'));

    const saved = JSON.parse(localStorage.getItem('chat-session-storage:v1')!);
    expect(saved.state.drafts).toEqual({ 'conversation-1': 'before close' });
  });

  it('leaves state untouched when reconciling removes nothing', () => {
    const store = useChatStore.getState();
    store.addStreamingMessage({
      ...message('local-1'),
      conversationId: 'conversation-1',
      deliveryStatus: 'pending',
    });
    const before = useChatStore.getState();
    const listener = vi.fn();
    const unsubscribe = useChatStore.subscribe(listener);

    store.reconcileMessages('conversation-1', new Set(['server-9']));

    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    expect(useChatStore.getState()).toBe(before);
  });

  it('merges task progress updates', () => {
    const store = useChatStore.getState();
    store.updateTaskProgress('task-1', { status: 'running', progress: 50 });
    store.updateTaskProgress('task-1', { progress: 100, result: 'done' });

    expect(useChatStore.getState().taskProgress['task-1']).toEqual({
      status: 'running',
      progress: 100,
      result: 'done',
    });
  });

  it('clears messages and aborts an active stream', () => {
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, 'abort');
    useChatStore.setState({
      streamingMessages: [message('stream-1')],
      isStreaming: true,
      streamAbortController: controller,
    });

    useChatStore.getState().clearStreamingState();

    expect(abortSpy).toHaveBeenCalledOnce();
    expect(useChatStore.getState().streamingMessages).toEqual([]);
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().streamAbortController).toBeNull();
  });

  it('resetToDemo clears all ephemeral state', () => {
    useChatStore.setState({
      streamingMessages: [message('stream-1')],
      currentConversationId: 'conversation-1',
      isStreaming: true,
      streamAbortController: new AbortController(),
      taskProgress: { 'task-1': { status: 'running' } },
    });

    useChatStore.getState().resetToDemo();

    expect(useChatStore.getState()).toMatchObject({
      streamingMessages: [],
      currentConversationId: null,
      isStreaming: false,
      streamAbortController: null,
      taskProgress: {},
    });
  });
});
