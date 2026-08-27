import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/useAuthStore';
import useDataSync from '../useDataSync';

const queryMocks = vi.hoisted(() => ({
  todos: { isLoading: false, refetch: vi.fn() },
  events: { isLoading: false, refetch: vi.fn() },
  conversations: { isLoading: false, refetch: vi.fn() },
  projects: { isLoading: false, refetch: vi.fn() },
}));

const fetchSettings = vi.hoisted(() => vi.fn());

vi.mock('../queries', () => ({
  useTodosQuery: () => queryMocks.todos,
  useEventsQuery: () => queryMocks.events,
  useConversationsQuery: () => queryMocks.conversations,
  useProjectsQuery: () => queryMocks.projects,
}));

vi.mock('../../stores/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ fetchSettings }),
  },
}));

describe('useDataSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMocks.todos.isLoading = false;
    queryMocks.events.isLoading = false;
    queryMocks.conversations.isLoading = false;
    queryMocks.projects.isLoading = false;
    useAuthStore.setState({ serverUrl: null });
  });

  it('reports syncing while any source query is loading', () => {
    queryMocks.events.isLoading = true;

    const { result } = renderHook(() => useDataSync());

    expect(result.current.syncing).toBe(true);
  });

  it('does not refetch without a configured server', () => {
    const { result } = renderHook(() => useDataSync());

    result.current.refresh();

    expect(queryMocks.todos.refetch).not.toHaveBeenCalled();
    expect(fetchSettings).not.toHaveBeenCalled();
  });

  it('refreshes every server-data query and settings', () => {
    useAuthStore.setState({ serverUrl: 'http://localhost:8000' });
    const { result } = renderHook(() => useDataSync());

    result.current.refresh();

    expect(queryMocks.todos.refetch).toHaveBeenCalledOnce();
    expect(queryMocks.events.refetch).toHaveBeenCalledOnce();
    expect(queryMocks.conversations.refetch).toHaveBeenCalledOnce();
    expect(queryMocks.projects.refetch).toHaveBeenCalledOnce();
    expect(fetchSettings).toHaveBeenCalledOnce();
  });
});
