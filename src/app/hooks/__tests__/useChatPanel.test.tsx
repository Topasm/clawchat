import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import useChatPanel from '../useChatPanel';
import { useChatStore } from '../../stores/useChatStore';

describe('useChatPanel', () => {
  beforeEach(() => {
    useChatStore.getState().setCurrentConversationId(null);
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
