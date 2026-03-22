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
      connectionStatus: 'disconnected',
    });
    useModuleStore.getState().resetToDemo();
    useChatStore.getState().resetToDemo();
  });

  it('fetch methods call API (no demo guard in stores)', async () => {
    const apiClient = (await import('../../services/apiClient')).default;

    await useModuleStore.getState().fetchTodos();
    await useModuleStore.getState().fetchEvents();
    await useChatStore.getState().fetchConversations();

    // Stores call apiClient regardless — apiClient handles missing auth
    expect(apiClient.get).toHaveBeenCalled();
  });

  it('fetch methods call API when serverUrl is set', async () => {
    const apiClient = (await import('../../services/apiClient')).default;
    useAuthStore.setState({ serverUrl: 'http://localhost:3000', token: 'tok' });

    await useModuleStore.getState().fetchTodos();
    await useModuleStore.getState().fetchEvents();
    await useChatStore.getState().fetchConversations();

    // 2 module fetches + 1 chat fetch = 3 calls
    expect(apiClient.get).toHaveBeenCalledTimes(3);
  });

  it('setKanbanStatuses clears overrides before fetch', () => {
    useModuleStore.getState().setKanbanStatuses({});
    expect(useModuleStore.getState().kanbanStatuses).toEqual({});
  });

  it('starts with empty data when no server', () => {
    const todos = useModuleStore.getState().todos;
    expect(todos).toHaveLength(0);
  });
});
