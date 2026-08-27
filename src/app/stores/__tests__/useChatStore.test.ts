import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore, type ChatMessage } from '../useChatStore';

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
