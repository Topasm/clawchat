import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../../stores/useAuthStore';
import { useModuleStore } from '../../stores/useModuleStore';
import { useChatStore } from '../../stores/useChatStore';

// Mock apiClient
vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { items: [] } }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
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

describe('useDataSync logic (store-level)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      token: null,
      refreshToken: null,
      serverUrl: null,
      isLoading: false,
      connectionStatus: 'demo',
    });
    useModuleStore.getState().resetToDemo();
    useChatStore.getState().resetToDemo();
  });

  it('fetch methods are no-ops in demo mode', async () => {
    const apiClient = (await import('../../services/apiClient')).default;

    await useModuleStore.getState().fetchTodos();
    await useModuleStore.getState().fetchEvents();
    await useModuleStore.getState().fetchMemos();
    await useChatStore.getState().fetchConversations();

    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('fetch methods call API when serverUrl is set', async () => {
    const apiClient = (await import('../../services/apiClient')).default;
    useAuthStore.setState({ serverUrl: 'http://localhost:3000', token: 'tok' });

    await useModuleStore.getState().fetchTodos();
    await useModuleStore.getState().fetchEvents();
    await useModuleStore.getState().fetchMemos();
    await useChatStore.getState().fetchConversations();

    // 3 module fetches + 1 chat fetch = 4 calls
    expect(apiClient.get).toHaveBeenCalledTimes(4);
  });

  it('setKanbanStatuses clears overrides before fetch', () => {
    useModuleStore.getState().setKanbanStatuses({});
    expect(useModuleStore.getState().kanbanStatuses).toEqual({});
  });

  it('demo data is preserved when no server', () => {
    const todos = useModuleStore.getState().todos;
    expect(todos.length).toBeGreaterThan(0);
    expect(todos[0].id).toContain('demo');
  });
});
