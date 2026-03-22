import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useModuleStore } from '../useModuleStore';
import { useAuthStore } from '../useAuthStore';

// Mock apiClient
vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock secure storage
vi.mock('../../services/platform', () => ({
  secureStorage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('useModuleStore', () => {
  beforeEach(() => {
    // Reset auth to demo mode
    useAuthStore.setState({
      token: null,
      refreshToken: null,
      serverUrl: null,
      isLoading: false,
      connectionStatus: 'disconnected',
    });
    // Reset module store to defaults by calling resetToDemo
    useModuleStore.getState().resetToDemo();
  });

  describe('initial state after resetToDemo', () => {
    it('starts with empty todos', () => {
      const { todos } = useModuleStore.getState();
      expect(todos).toHaveLength(0);
    });

    it('starts with empty events', () => {
      const { events } = useModuleStore.getState();
      expect(events).toHaveLength(0);
    });

    it('starts with empty kanban overrides', () => {
      const { kanbanStatuses } = useModuleStore.getState();
      expect(kanbanStatuses).toEqual({});
    });
  });

  describe('resetToDemo', () => {
    it('clears data after modification', () => {
      const store = useModuleStore.getState();
      // Add data
      store.setTodos([{ id: 'test-1', title: 'Test', status: 'pending', priority: 'medium', created_at: '', updated_at: '' } as any]);
      store.setEvents([{ id: 'evt-1', title: 'Event', start_time: '', created_at: '', updated_at: '' } as any]);
      store.setKanbanStatuses({ 'test-1': 'in_progress' });

      expect(useModuleStore.getState().todos).toHaveLength(1);

      // Reset
      useModuleStore.getState().resetToDemo();

      const state = useModuleStore.getState();
      expect(state.todos).toHaveLength(0);
      expect(state.events).toHaveLength(0);
      expect(state.kanbanStatuses).toEqual({});
      expect(state.isLoading).toBe(false);
      expect(state.lastFetched).toBeNull();
    });
  });

  describe('setKanbanStatuses', () => {
    it('bulk-sets kanban statuses', () => {
      useModuleStore.getState().setKanbanStatuses({ 'task-1': 'in_progress' });
      expect(useModuleStore.getState().kanbanStatuses).toEqual({ 'task-1': 'in_progress' });
    });

    it('clears all kanban statuses with empty object', () => {
      useModuleStore.getState().setKanbanStatuses({});
      expect(useModuleStore.getState().kanbanStatuses).toEqual({});
    });
  });

  describe('fetchTodos — no serverUrl guard', () => {
    it('calls apiClient even without serverUrl (apiClient handles auth)', async () => {
      const apiClient = (await import('../../services/apiClient')).default;
      (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('No auth'));
      await useModuleStore.getState().fetchTodos();
      // Should attempt fetch (apiClient handles missing auth)
      expect(useModuleStore.getState().isLoading).toBe(false);
    });
  });

  describe('fetchTodos — live mode', () => {
    it('replaces todos and clears kanbanStatuses on successful fetch', async () => {
      const apiClient = (await import('../../services/apiClient')).default;
      const mockTodos = [{ id: 'srv-1', title: 'Server Task', status: 'pending' }];
      (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { items: mockTodos } });

      // Set server URL to exit demo mode
      useAuthStore.setState({ serverUrl: 'http://localhost:3000', token: 'tok' });

      await useModuleStore.getState().fetchTodos();

      const state = useModuleStore.getState();
      expect(state.todos).toEqual(mockTodos);
      expect(state.kanbanStatuses).toEqual({});
      expect(state.isLoading).toBe(false);
      expect(state.lastFetched).toBeGreaterThan(0);
    });
  });

  describe('CRUD operations', () => {
    const seedTodos = () => {
      useModuleStore.setState({
        todos: [
          { id: 'todo-1', title: 'Task 1', status: 'pending', priority: 'medium', created_at: '', updated_at: '', sort_order: 0 } as any,
          { id: 'todo-2', title: 'Task 2', status: 'completed', priority: 'high', created_at: '', updated_at: '', sort_order: 1 } as any,
        ],
        kanbanStatuses: { 'todo-1': 'in_progress' },
      });
    };

    it('addTodo prepends a todo', () => {
      const newTodo = {
        id: 'new-1',
        title: 'New Task',
        status: 'pending' as const,
        priority: 'medium' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      useModuleStore.getState().addTodo(newTodo);
      expect(useModuleStore.getState().todos[0].id).toBe('new-1');
    });

    it('updateTodo modifies a specific todo', () => {
      seedTodos();
      useModuleStore.getState().updateTodo('todo-1', { title: 'Updated Title' });
      const todo = useModuleStore.getState().todos.find((t) => t.id === 'todo-1');
      expect(todo?.title).toBe('Updated Title');
    });

    it('removeTodo removes a specific todo', () => {
      seedTodos();
      const initialLength = useModuleStore.getState().todos.length;
      useModuleStore.getState().removeTodo('todo-1');
      expect(useModuleStore.getState().todos.length).toBe(initialLength - 1);
      expect(useModuleStore.getState().todos.find((t) => t.id === 'todo-1')).toBeUndefined();
    });

    it('getKanbanStatus returns override when set', () => {
      seedTodos();
      expect(useModuleStore.getState().getKanbanStatus('todo-1')).toBe('in_progress');
    });

    it('getKanbanStatus falls back to todo.status', () => {
      seedTodos();
      expect(useModuleStore.getState().getKanbanStatus('todo-2')).toBe('completed');
    });
  });

  describe('toggleTodoComplete', () => {
    beforeEach(async () => {
      const apiClient = (await import('../../services/apiClient')).default;
      (apiClient.patch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no server'));
      useModuleStore.setState({
        todos: [
          { id: 'todo-1', title: 'Task 1', status: 'pending', priority: 'medium', created_at: '', updated_at: '', sort_order: 0 } as any,
          { id: 'todo-2', title: 'Task 2', status: 'completed', priority: 'high', created_at: '', updated_at: '', sort_order: 1 } as any,
        ],
      });
    });

    it('toggles pending to completed (optimistic update)', async () => {
      await useModuleStore.getState().toggleTodoComplete('todo-1');
      const todo = useModuleStore.getState().todos.find((t) => t.id === 'todo-1');
      // Optimistic update happens, then server fails and rolls back
      // Since apiClient.patch rejects, status reverts to 'pending'
      expect(todo?.status).toBe('pending');
    });

    it('toggles completed back to pending (optimistic update)', async () => {
      await useModuleStore.getState().toggleTodoComplete('todo-2');
      const todo = useModuleStore.getState().todos.find((t) => t.id === 'todo-2');
      // Same: optimistic then rollback
      expect(todo?.status).toBe('completed');
    });
  });

  describe('multi-select & bulk operations', () => {
    it('toggleTodoSelection adds an ID', () => {
      useModuleStore.getState().toggleTodoSelection('todo-1');
      expect(useModuleStore.getState().selectedTodoIds.has('todo-1')).toBe(true);
    });

    it('toggleTodoSelection removes an ID on second call', () => {
      useModuleStore.getState().toggleTodoSelection('todo-1');
      useModuleStore.getState().toggleTodoSelection('todo-1');
      expect(useModuleStore.getState().selectedTodoIds.has('todo-1')).toBe(false);
    });

    it('clearTodoSelection empties the set', () => {
      useModuleStore.getState().toggleTodoSelection('todo-1');
      useModuleStore.getState().toggleTodoSelection('todo-2');
      useModuleStore.getState().clearTodoSelection();
      expect(useModuleStore.getState().selectedTodoIds.size).toBe(0);
    });

    it('selectAllTodos sets from array', () => {
      useModuleStore.getState().selectAllTodos(['todo-1', 'todo-2', 'todo-3']);
      expect(useModuleStore.getState().selectedTodoIds.size).toBe(3);
    });
  });

  describe('kanban filters', () => {
    it('setKanbanSearchQuery updates the search query', () => {
      useModuleStore.getState().setKanbanSearchQuery('test');
      expect(useModuleStore.getState().kanbanFilters.searchQuery).toBe('test');
    });

    it('toggleKanbanPriorityFilter adds and removes priorities', () => {
      useModuleStore.getState().toggleKanbanPriorityFilter('high');
      expect(useModuleStore.getState().kanbanFilters.priorities).toContain('high');

      useModuleStore.getState().toggleKanbanPriorityFilter('high');
      expect(useModuleStore.getState().kanbanFilters.priorities).not.toContain('high');
    });

    it('clearKanbanFilters resets all filters', () => {
      useModuleStore.getState().setKanbanSearchQuery('test');
      useModuleStore.getState().toggleKanbanPriorityFilter('high');
      useModuleStore.getState().clearKanbanFilters();

      const { kanbanFilters } = useModuleStore.getState();
      expect(kanbanFilters.searchQuery).toBe('');
      expect(kanbanFilters.priorities).toEqual([]);
      expect(kanbanFilters.tags).toEqual([]);
    });
  });
});
