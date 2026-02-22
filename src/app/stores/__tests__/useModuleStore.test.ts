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
      connectionStatus: 'demo',
    });
    // Reset module store to defaults by calling resetToDemo
    useModuleStore.getState().resetToDemo();
  });

  describe('demo data seeding', () => {
    it('starts with demo todos', () => {
      const { todos } = useModuleStore.getState();
      expect(todos.length).toBeGreaterThan(0);
      expect(todos[0].id).toMatch(/^demo-/);
    });

    it('starts with demo events', () => {
      const { events } = useModuleStore.getState();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].id).toMatch(/^demo-/);
    });

    it('starts with demo memos', () => {
      const { memos } = useModuleStore.getState();
      expect(memos.length).toBeGreaterThan(0);
      expect(memos[0].id).toMatch(/^memo-/);
    });

    it('starts with demo kanban overrides', () => {
      const { kanbanStatuses } = useModuleStore.getState();
      expect(kanbanStatuses['demo-5']).toBe('in_progress');
      expect(kanbanStatuses['demo-11']).toBe('in_progress');
      expect(kanbanStatuses['demo-12']).toBe('in_progress');
    });
  });

  describe('resetToDemo', () => {
    it('restores demo data after modification', () => {
      const store = useModuleStore.getState();
      // Mutate state
      store.setTodos([]);
      store.setEvents([]);
      store.setMemos([]);
      store.setKanbanStatuses({});

      expect(useModuleStore.getState().todos).toHaveLength(0);

      // Reset
      useModuleStore.getState().resetToDemo();

      const state = useModuleStore.getState();
      expect(state.todos.length).toBeGreaterThan(0);
      expect(state.events.length).toBeGreaterThan(0);
      expect(state.memos.length).toBeGreaterThan(0);
      expect(state.kanbanStatuses['demo-5']).toBe('in_progress');
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

  describe('fetchTodos — demo mode guard', () => {
    it('does not fetch when in demo mode (no serverUrl)', async () => {
      const originalTodos = useModuleStore.getState().todos;
      await useModuleStore.getState().fetchTodos();
      // Todos should remain unchanged (demo data kept)
      expect(useModuleStore.getState().todos).toBe(originalTodos);
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
      useModuleStore.getState().updateTodo('demo-1', { title: 'Updated Title' });
      const todo = useModuleStore.getState().todos.find((t) => t.id === 'demo-1');
      expect(todo?.title).toBe('Updated Title');
    });

    it('removeTodo removes a specific todo', () => {
      const initialLength = useModuleStore.getState().todos.length;
      useModuleStore.getState().removeTodo('demo-1');
      expect(useModuleStore.getState().todos.length).toBe(initialLength - 1);
      expect(useModuleStore.getState().todos.find((t) => t.id === 'demo-1')).toBeUndefined();
    });

    it('getKanbanStatus returns override when set', () => {
      expect(useModuleStore.getState().getKanbanStatus('demo-5')).toBe('in_progress');
    });

    it('getKanbanStatus falls back to todo.status', () => {
      expect(useModuleStore.getState().getKanbanStatus('demo-1')).toBe('pending');
    });
  });

  describe('toggleTodoComplete', () => {
    it('toggles pending to completed (optimistic update)', async () => {
      // In demo mode — no server call
      await useModuleStore.getState().toggleTodoComplete('demo-1');
      const todo = useModuleStore.getState().todos.find((t) => t.id === 'demo-1');
      expect(todo?.status).toBe('completed');
    });

    it('toggles completed back to pending', async () => {
      await useModuleStore.getState().toggleTodoComplete('demo-7'); // demo-7 is completed
      const todo = useModuleStore.getState().todos.find((t) => t.id === 'demo-7');
      expect(todo?.status).toBe('pending');
    });
  });

  describe('multi-select & bulk operations', () => {
    it('toggleTodoSelection adds an ID', () => {
      useModuleStore.getState().toggleTodoSelection('demo-1');
      expect(useModuleStore.getState().selectedTodoIds.has('demo-1')).toBe(true);
    });

    it('toggleTodoSelection removes an ID on second call', () => {
      useModuleStore.getState().toggleTodoSelection('demo-1');
      useModuleStore.getState().toggleTodoSelection('demo-1');
      expect(useModuleStore.getState().selectedTodoIds.has('demo-1')).toBe(false);
    });

    it('clearTodoSelection empties the set', () => {
      useModuleStore.getState().toggleTodoSelection('demo-1');
      useModuleStore.getState().toggleTodoSelection('demo-2');
      useModuleStore.getState().clearTodoSelection();
      expect(useModuleStore.getState().selectedTodoIds.size).toBe(0);
    });

    it('selectAllTodos sets from array', () => {
      useModuleStore.getState().selectAllTodos(['demo-1', 'demo-2', 'demo-3']);
      expect(useModuleStore.getState().selectedTodoIds.size).toBe(3);
    });

    it('bulkUpdateTodos in demo mode updates status locally', async () => {
      await useModuleStore.getState().bulkUpdateTodos({
        ids: ['demo-1', 'demo-2'],
        status: 'completed',
      });
      const state = useModuleStore.getState();
      expect(state.todos.find((t) => t.id === 'demo-1')?.status).toBe('completed');
      expect(state.todos.find((t) => t.id === 'demo-2')?.status).toBe('completed');
      expect(state.selectedTodoIds.size).toBe(0);
    });

    it('bulkUpdateTodos in demo mode deletes locally', async () => {
      const initialLength = useModuleStore.getState().todos.length;
      await useModuleStore.getState().bulkUpdateTodos({
        ids: ['demo-1', 'demo-2'],
        delete: true,
      });
      expect(useModuleStore.getState().todos.length).toBe(initialLength - 2);
    });
  });

  describe('demo data — sub-tasks', () => {
    it('has some todos with parent_id set', () => {
      const { todos } = useModuleStore.getState();
      const subTasks = todos.filter((t) => t.parent_id);
      expect(subTasks.length).toBeGreaterThan(0);
    });

    it('has sort_order on all demo todos', () => {
      const { todos } = useModuleStore.getState();
      todos.forEach((t) => {
        expect(typeof t.sort_order).toBe('number');
      });
    });

    it('sub-tasks reference existing parent IDs', () => {
      const { todos } = useModuleStore.getState();
      const ids = new Set(todos.map((t) => t.id));
      const subTasks = todos.filter((t) => t.parent_id);
      subTasks.forEach((st) => {
        expect(ids.has(st.parent_id!)).toBe(true);
      });
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
