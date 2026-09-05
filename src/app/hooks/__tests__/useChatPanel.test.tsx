import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import useChatPanel from '../useChatPanel';
import { getChatWorkspaceScope, useChatStore } from '../../stores/useChatStore';

describe('useChatPanel', () => {
  it('invalidates earlier selections across callers, direct opens and closing', () => {
    const { result } = renderHook(() => useChatPanel());
    const first = result.current.beginSelection();
    const second = result.current.beginSelection();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    act(() => result.current.open('direct-thread'));
    expect(second()).toBe(false);
    const pending = result.current.beginSelection();
    act(() => result.current.close());
    expect(pending()).toBe(false);
  });
  beforeEach(() => {
    useChatStore.getState().setCurrentConversationId(null);
  });

  it('remembers each project run across panel reset and persistence rehydration', async () => {
    const { result } = renderHook(() => useChatPanel());
    act(() => {
      useChatStore.getState().setProjectPlanSelection('a', { view: 'flow', taskId: 'task-a' });
      result.current.open('run-a', { projectId: 'a', kind: 'run', title: 'Task Agent' });
      result.current.reset();
      result.current.open('run-b', { projectId: 'b', kind: 'run', title: 'Task Agent' });
      result.current.reset();
    });
    await act(async () => {
      await useChatStore.persist.rehydrate();
    });
    const saved = useChatStore.getState().activeConversationByProject;
    expect(
      useChatStore.getState().projectPlanSelections[JSON.stringify([getChatWorkspaceScope(), 'a'])],
    ).toEqual({ view: 'flow', taskId: 'task-a' });
    expect(saved[JSON.stringify([getChatWorkspaceScope(), 'a'])]).toEqual({
      conversationId: 'run-a',
      kind: 'run',
    });
    expect(saved[JSON.stringify([getChatWorkspaceScope(), 'b'])]).toEqual({
      conversationId: 'run-b',
      kind: 'run',
    });
  });

  it('opens a scoped project conversation and resets to Quick Chat', () => {
    const { result } = renderHook(() => useChatPanel());

    act(() => {
      result.current.open('conv-project', {
        kind: 'project',
        title: 'Project Agent',
        subtitle: 'ClawChat improvements',
      });
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.conversationId).toBe('conv-project');
    expect(result.current.presentation).toEqual({
      kind: 'project',
      title: 'Project Agent',
      subtitle: 'ClawChat improvements',
    });

    act(() => result.current.reset());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.conversationId).toBeNull();
    expect(result.current.presentation).toEqual({ kind: 'quick', title: 'Quick Chat' });
  });

  it('restores the previous Quick Chat after leaving a project scope', () => {
    const { result } = renderHook(() => useChatPanel());

    act(() => result.current.open('conv-quick'));
    act(() => {
      result.current.open('conv-project', {
        kind: 'project',
        title: 'Project Agent',
      });
    });
    act(() => result.current.reset());

    expect(result.current.conversationId).toBe('conv-quick');
    expect(useChatStore.getState().currentConversationId).toBe('conv-quick');
  });
});
