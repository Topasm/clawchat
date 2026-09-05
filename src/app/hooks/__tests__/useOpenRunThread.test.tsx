import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useOpenRunThread from '../useOpenRunThread';

const mocks = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), selection: 0 }));
vi.mock('../../services/apiClient', () => ({ default: { get: mocks.get } }));
vi.mock('../../components/chat-panel/ChatPanelControllerContext', () => ({
  useOptionalChatPanelController: () => ({
    open: mocks.open,
    beginSelection: () => {
      const selection = ++mocks.selection;
      return () => selection === mocks.selection;
    },
  }),
}));
vi.mock('../../types/schemas', () => ({
  AgentRunResponseSchema: { parse: (data: unknown) => data },
}));

describe('useOpenRunThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the execution conversation instead of the task planning conversation', async () => {
    mocks.get.mockResolvedValue({ data: { conversation_id: 'run-thread', todo_title: 'Task' } });
    const { result } = renderHook(() => useOpenRunThread(), { wrapper: MemoryRouter });
    await act(async () => {
      await result.current('run-1');
    });
    expect(mocks.get).toHaveBeenCalledWith('/runs/run-1');
    expect(mocks.open).toHaveBeenCalledWith('run-thread', {
      kind: 'run',
      title: 'Task Agent',
      subtitle: 'Task',
    });
  });

  it('does not let a slower request replace the most recently selected run', async () => {
    let resolveFirst!: (value: unknown) => void;
    mocks.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    mocks.get.mockResolvedValueOnce({ data: { conversation_id: 'second-thread' } });
    const { result } = renderHook(() => useOpenRunThread(), { wrapper: MemoryRouter });
    await act(async () => {
      const first = result.current('first');
      await result.current('second');
      resolveFirst({ data: { conversation_id: 'first-thread' } });
      await first;
    });
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open.mock.calls[0][0]).toBe('second-thread');
  });

  it('does not open a thread after the initiating screen unmounts', async () => {
    let resolve!: (value: unknown) => void;
    mocks.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result, unmount } = renderHook(() => useOpenRunThread(), { wrapper: MemoryRouter });
    const open = result.current;
    const pending = open('run-1');
    unmount();
    resolve({ data: { conversation_id: 'late-thread' } });
    await pending;
    await open('run-2');
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('honors the newest selection made by a different hook instance', async () => {
    let resolve!: (value: unknown) => void;
    mocks.get.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mocks.get.mockResolvedValueOnce({ data: { conversation_id: 'newest-thread' } });
    const { result } = renderHook(
      () => ({ first: useOpenRunThread(), second: useOpenRunThread() }),
      { wrapper: MemoryRouter },
    );
    await act(async () => {
      const pending = result.current.first('old-run');
      await result.current.second('new-run');
      resolve({ data: { conversation_id: 'old-thread' } });
      await pending;
    });
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open.mock.calls[0][0]).toBe('newest-thread');
  });
});
