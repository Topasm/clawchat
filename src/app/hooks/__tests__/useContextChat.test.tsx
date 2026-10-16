import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatPanelState } from '../useChatPanel';
import { useChatContextStore, useToggleContextChat } from '../useContextChat';

const mocks = vi.hoisted(() => ({ getOrCreate: vi.fn() }));

vi.mock('../queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries')>()),
  useGetOrCreateProjectConversation: () => ({ mutateAsync: mocks.getOrCreate }),
}));

function panel(isOpen = false): ChatPanelState {
  return {
    isOpen,
    conversationId: null,
    presentation: { kind: 'quick', title: 'Quick Chat' },
    toggle: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    setConversationId: vi.fn(),
    setPresentation: vi.fn(),
    reset: vi.fn(),
    beginSelection: () => () => true,
  };
}

function renderToggle(path: string, state: ChatPanelState) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    ['todos'],
    [{ id: 'todo-1', title: 'Gpu 컴퓨팅 과제', project_id: 'project-1' }],
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  return renderHook(() => useToggleContextChat(state), { wrapper }).result;
}

describe('useToggleContextChat', () => {
  beforeEach(() => {
    mocks.getOrCreate.mockReset();
    useChatContextStore.setState({ openHere: null });
  });

  it('opens the panel on the open task’s own conversation', async () => {
    mocks.getOrCreate.mockResolvedValue({ id: 'conv-task' });
    const state = panel();
    const toggle = renderToggle('/tasks/todo-1', state);

    act(() => toggle.current());

    await waitFor(() =>
      expect(state.open).toHaveBeenCalledWith('conv-task', {
        kind: 'task',
        title: 'Task Agent',
        subtitle: 'Gpu 컴퓨팅 과제',
        projectId: 'project-1',
      }),
    );
    expect(mocks.getOrCreate).toHaveBeenCalledWith('todo-1');
  });

  it('lets the screen on view open its own conversation', () => {
    const openHere = vi.fn();
    useChatContextStore.setState({ openHere });
    const state = panel();
    const toggle = renderToggle('/projects/project-1', state);

    act(() => toggle.current());

    expect(openHere).toHaveBeenCalledOnce();
    expect(state.open).not.toHaveBeenCalled();
  });

  it('opens a plain conversation elsewhere and closes an open panel', () => {
    const closed = panel();
    const openPlain = renderToggle('/schedule/today', closed);
    act(() => openPlain.current());
    expect(closed.open).toHaveBeenCalledWith();

    const open = panel(true);
    const close = renderToggle('/tasks/todo-1', open);
    act(() => close.current());
    expect(open.close).toHaveBeenCalledOnce();
    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });
});
