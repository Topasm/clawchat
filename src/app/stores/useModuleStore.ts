import { create } from 'zustand';
import apiClient from '../services/apiClient';
import { useToastStore } from './useToastStore';
import { logger } from '../services/logger';
import type {
  TodoResponse,
  TodoCreate,
  TodoUpdate,
  EventResponse,
  EventCreate,
  EventUpdate,
  KanbanStatus,
  BulkTodoUpdate,
} from '../types/api';

interface ModuleState {
  isLoading: boolean;
  lastFetched: number | null;

  todos: TodoResponse[];
  setTodos: (todos: TodoResponse[]) => void;
  addTodo: (todo: TodoResponse) => void;
  updateTodo: (id: string, updates: Partial<TodoResponse>) => void;
  removeTodo: (id: string) => void;

  kanbanStatuses: Record<string, KanbanStatus>;
  setKanbanStatus: (id: string, status: KanbanStatus) => void;
  getKanbanStatus: (id: string) => KanbanStatus;

  events: EventResponse[];
  setEvents: (events: EventResponse[]) => void;
  addEvent: (event: EventResponse) => void;
  updateEvent: (id: string, updates: Partial<EventResponse>) => void;
  removeEvent: (id: string) => void;

  setKanbanStatuses: (statuses: Record<string, KanbanStatus>) => void;
  resetToDemo: () => void;

  // Multi-select & bulk operations
  selectedTodoIds: Set<string>;
  toggleTodoSelection: (id: string) => void;
  selectAllTodos: (ids: string[]) => void;
  clearTodoSelection: () => void;
  bulkUpdateTodos: (update: BulkTodoUpdate) => Promise<void>;
  reorderTodoInColumn: (todoId: string, newIndex: number, columnStatus: KanbanStatus) => void;

  // Kanban filters
  kanbanFilters: {
    searchQuery: string;
    priorities: string[];
    tags: string[];
    sortField: 'title' | 'priority' | 'due_date' | 'created_at' | 'updated_at' | 'sort_order';
    sortDirection: 'asc' | 'desc';
    showSubTasks: boolean;
  };
  setKanbanSearchQuery: (query: string) => void;
  toggleKanbanPriorityFilter: (priority: string) => void;
  toggleKanbanTagFilter: (tag: string) => void;
  setKanbanSort: (field: 'title' | 'priority' | 'due_date' | 'created_at' | 'updated_at' | 'sort_order', direction: 'asc' | 'desc') => void;
  clearKanbanFilters: () => void;
  toggleShowSubTasks: () => void;

  // Async actions
  fetchTodos: (params?: Record<string, string>) => Promise<void>;
  fetchEvents: (params?: Record<string, string>) => Promise<void>;
  toggleTodoComplete: (id: string) => Promise<void>;
  createTodo: (data: TodoCreate) => Promise<TodoResponse>;
  createEvent: (data: EventCreate) => Promise<EventResponse>;
  deleteTodo: (id: string) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  deleteEventOccurrence: (eventId: string, date: string, mode: string) => Promise<void>;
  serverUpdateTodo: (id: string, data: TodoUpdate) => Promise<void>;
  serverUpdateEvent: (id: string, data: EventUpdate) => Promise<void>;
}

const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();

export const useModuleStore = create<ModuleState>()((set, get) => ({
  isLoading: false,
  lastFetched: null,

  // --- Todos ---
  todos: [],
  setTodos: (todos) => set({ todos }),
  addTodo: (todo) => set((state) => ({ todos: [todo, ...state.todos] })),
  updateTodo: (id, updates) =>
    set((state) => ({
      todos: state.todos.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  removeTodo: (id) =>
    set((state) => ({ todos: state.todos.filter((t) => t.id !== id) })),

  kanbanStatuses: {} as Record<string, KanbanStatus>,
  setKanbanStatus: (id, status) => {
    // Capture previous state for rollback
    const prevKanbanStatus = get().kanbanStatuses[id];
    const prevTodo = get().todos.find((t) => t.id === id);

    set((state) => ({
      kanbanStatuses: { ...state.kanbanStatuses, [id]: status },
    }));
    const label = status === 'in_progress' ? 'In Progress' : status === 'completed' ? 'Done' : 'Todo';
    useToastStore.getState().addToast('success', `Task moved to ${label}`);
    // Sync to server: in_progress maps to pending on the server
    const serverStatus = status === 'in_progress' ? 'pending' : status;
    const { todos } = get();
    const todo = todos.find((t) => t.id === id);
    if (todo && todo.status !== serverStatus) {
      set((state) => ({
        todos: state.todos.map((t) => (t.id === id ? { ...t, status: serverStatus } : t)),
      }));
      apiClient.patch(`/todos/${id}`, { status: serverStatus }).catch(() => {
        // Rollback kanban status and todo status on server error
        set((state) => ({
          kanbanStatuses: prevKanbanStatus !== undefined
            ? { ...state.kanbanStatuses, [id]: prevKanbanStatus }
            : (() => { const next = { ...state.kanbanStatuses }; delete next[id]; return next; })(),
          todos: state.todos.map((t) =>
            t.id === id ? { ...t, status: prevTodo?.status ?? t.status } : t,
          ),
        }));
        useToastStore.getState().addToast('error', 'Failed to move task on server, change reverted');
      });
    }
  },
  getKanbanStatus: (id) => {
    const { kanbanStatuses, todos } = get();
    if (kanbanStatuses[id]) return kanbanStatuses[id];
    const todo = todos.find((t) => t.id === id);
    return todo?.status ?? 'pending';
  },

  setKanbanStatuses: (statuses) => set({ kanbanStatuses: statuses }),

  // --- Multi-select & bulk ---
  selectedTodoIds: new Set<string>(),
  toggleTodoSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedTodoIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { selectedTodoIds: next };
    }),
  selectAllTodos: (ids) => set({ selectedTodoIds: new Set(ids) }),
  clearTodoSelection: () => set({ selectedTodoIds: new Set<string>() }),
  bulkUpdateTodos: async (update) => {
    try {
      await apiClient.patch('/todos/bulk', update);
      await get().fetchTodos();
      set({ selectedTodoIds: new Set<string>() });
      useToastStore.getState().addToast('success', `Bulk operation completed`);
    } catch (err) {
      logger.warn('Bulk update failed:', err);
      useToastStore.getState().addToast('error', 'Bulk operation failed');
    }
  },
  reorderTodoInColumn: (todoId, newIndex, columnStatus) => {
    const { todos, kanbanStatuses } = get();
    const getEffective = (t: TodoResponse): KanbanStatus =>
      kanbanStatuses[t.id] ?? (t.status as KanbanStatus);
    const columnTodos = todos
      .filter((t) => getEffective(t) === columnStatus && !t.parent_id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const fromIdx = columnTodos.findIndex((t) => t.id === todoId);
    if (fromIdx < 0) return;
    const [moved] = columnTodos.splice(fromIdx, 1);
    columnTodos.splice(newIndex, 0, moved);
    // Reassign sort_order
    const updates: Record<string, number> = {};
    columnTodos.forEach((t, i) => { updates[t.id] = i; });
    set((state) => ({
      todos: state.todos.map((t) =>
        updates[t.id] !== undefined ? { ...t, sort_order: updates[t.id] } : t,
      ),
    }));
    // Persist to server
    Promise.all(
      Object.entries(updates).map(([id, order]) =>
        apiClient.patch(`/todos/${id}`, { sort_order: order }),
      ),
    ).catch((err) => {
      logger.warn('Failed to persist reorder to server:', err);
      useToastStore.getState().addToast('error', 'Failed to save reorder on server');
    });
  },

  resetToDemo: () => {
    // Cancel any pending undo-able delete timers so they don't fire after reset
    for (const [, timer] of pendingDeletes) clearTimeout(timer);
    pendingDeletes.clear();

    set({
      todos: [],
      events: [],
      kanbanStatuses: {} as Record<string, KanbanStatus>,
      selectedTodoIds: new Set<string>(),
      isLoading: false,
      lastFetched: null,
    });
  },

  // --- Events ---
  events: [],
  setEvents: (events) => set({ events }),
  addEvent: (event) => set((state) => ({ events: [event, ...state.events] })),
  updateEvent: (id, updates) =>
    set((state) => ({
      events: state.events.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    })),
  removeEvent: (id) =>
    set((state) => ({ events: state.events.filter((e) => e.id !== id) })),

  // --- Kanban filters ---
  kanbanFilters: {
    searchQuery: '',
    priorities: [],
    tags: [],
    sortField: 'created_at' as const,
    sortDirection: 'desc' as const,
    showSubTasks: false,
  },
  setKanbanSearchQuery: (query) =>
    set((state) => ({ kanbanFilters: { ...state.kanbanFilters, searchQuery: query } })),
  toggleKanbanPriorityFilter: (priority) =>
    set((state) => {
      const current = state.kanbanFilters.priorities;
      const next = current.includes(priority)
        ? current.filter((p) => p !== priority)
        : [...current, priority];
      return { kanbanFilters: { ...state.kanbanFilters, priorities: next } };
    }),
  toggleKanbanTagFilter: (tag) =>
    set((state) => {
      const current = state.kanbanFilters.tags;
      const next = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag];
      return { kanbanFilters: { ...state.kanbanFilters, tags: next } };
    }),
  setKanbanSort: (field, direction) =>
    set((state) => ({ kanbanFilters: { ...state.kanbanFilters, sortField: field, sortDirection: direction } })),
  clearKanbanFilters: () =>
    set({
      kanbanFilters: {
        searchQuery: '',
        priorities: [],
        tags: [],
        sortField: 'created_at',
        sortDirection: 'desc',
        showSubTasks: false,
      },
    }),
  toggleShowSubTasks: () =>
    set((state) => ({
      kanbanFilters: { ...state.kanbanFilters, showSubTasks: !state.kanbanFilters.showSubTasks },
    })),

  // --- Async actions ---

  fetchTodos: async (params) => {
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/todos', { params });
      set({ todos: response.data?.items ?? response.data ?? [], kanbanStatuses: {}, isLoading: false, lastFetched: Date.now() });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchEvents: async (params) => {
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/events', { params });
      set({ events: response.data?.items ?? response.data ?? [], isLoading: false, lastFetched: Date.now() });
    } catch {
      set({ isLoading: false });
    }
  },

  toggleTodoComplete: async (id) => {
    const { todos, kanbanStatuses } = get();
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    const newStatus = todo.status === 'completed' ? 'pending' : 'completed';
    // Capture previous kanban status for rollback (optimistic update deletes it)
    const prevKanbanStatus = kanbanStatuses[id];
    // Optimistic update
    set((state) => {
      const next = { ...state.kanbanStatuses };
      delete next[id];
      return {
        todos: state.todos.map((t) => (t.id === id ? { ...t, status: newStatus } : t)),
        kanbanStatuses: next,
      };
    });
    useToastStore.getState().addToast(
      'success',
      newStatus === 'completed' ? 'Task completed' : 'Task reopened',
    );
    try {
      await apiClient.patch(`/todos/${id}`, { status: newStatus });
    } catch {
      // Rollback: revert status and restore previous kanban status
      set((state) => ({
        todos: state.todos.map((t) => (t.id === id ? { ...t, status: todo.status } : t)),
        kanbanStatuses: prevKanbanStatus !== undefined
          ? { ...state.kanbanStatuses, [id]: prevKanbanStatus }
          : state.kanbanStatuses,
      }));
      useToastStore.getState().addToast('error', 'Failed to update task on server, change reverted');
    }
  },

  createTodo: async (data) => {
    const response = await apiClient.post('/todos', data);
    get().addTodo(response.data);
    useToastStore.getState().addToast('success', 'Task created');
    return response.data;
  },

  createEvent: async (data) => {
    const response = await apiClient.post('/events', data);
    get().addEvent(response.data);
    useToastStore.getState().addToast('success', 'Event created');
    return response.data;
  },

  deleteTodo: async (id) => {
    const { todos, kanbanStatuses } = get();
    const existing = todos.find((t) => t.id === id);
    if (!existing) return;
    const savedKanbanStatus = kanbanStatuses[id];

    get().removeTodo(id);

    const timeoutId = setTimeout(async () => {
      pendingDeletes.delete(id);
      try {
        await apiClient.delete(`/todos/${id}`);
      } catch (err) {
        logger.warn('Failed to delete todo on server:', err);
        get().addTodo(existing);
        if (savedKanbanStatus) get().setKanbanStatus(id, savedKanbanStatus);
        useToastStore.getState().addToast('error', 'Failed to delete task on server');
      }
    }, 5000);
    pendingDeletes.set(id, timeoutId);

    useToastStore.getState().addToast('success', 'Task deleted', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(timeoutId);
          pendingDeletes.delete(id);
          get().addTodo(existing);
          if (savedKanbanStatus) {
            set((state) => ({
              kanbanStatuses: { ...state.kanbanStatuses, [id]: savedKanbanStatus },
            }));
          }
        },
      },
    });
  },

  deleteEvent: async (id) => {
    const { events } = get();
    const existing = events.find((e) => e.id === id);
    if (!existing) return;

    get().removeEvent(id);

    const timeoutId = setTimeout(async () => {
      pendingDeletes.delete(id);
      try {
        await apiClient.delete(`/events/${id}`);
      } catch (err) {
        logger.warn('Failed to delete event on server:', err);
        get().addEvent(existing);
        useToastStore.getState().addToast('error', 'Failed to delete event on server');
      }
    }, 5000);
    pendingDeletes.set(id, timeoutId);

    useToastStore.getState().addToast('success', 'Event deleted', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(timeoutId);
          pendingDeletes.delete(id);
          get().addEvent(existing);
        },
      },
    });
  },

  deleteEventOccurrence: async (eventId, date, mode) => {
    if (mode === 'all') {
      // Delegate to deleteEvent for full series deletion
      await get().deleteEvent(eventId);
      return;
    }
    // For this_only and this_and_future, call the server endpoint
    try {
      await apiClient.delete(`/events/${eventId}/occurrences/${date}`, { params: { mode } });
      // Refresh events from server to reflect changes
      await get().fetchEvents();
      useToastStore.getState().addToast('success', 'Occurrence deleted');
    } catch (err) {
      logger.warn('Failed to delete event occurrence:', err);
      useToastStore.getState().addToast('error', 'Failed to delete occurrence');
    }
  },

  serverUpdateTodo: async (id, data) => {
    // Capture previous state for rollback
    const previousTodo = get().todos.find((t) => t.id === id);
    // Optimistic update
    get().updateTodo(id, { ...data, updated_at: new Date().toISOString() } as Partial<TodoResponse>);

    try {
      await apiClient.patch(`/todos/${id}`, data);
    } catch (err) {
      logger.warn('Failed to update todo on server:', err);
      if (previousTodo) get().updateTodo(id, previousTodo);
      useToastStore.getState().addToast('error', 'Failed to update task on server, changes reverted');
    }
  },

  serverUpdateEvent: async (id, data) => {
    const previousEvent = get().events.find((e) => e.id === id);
    get().updateEvent(id, { ...data, updated_at: new Date().toISOString() } as Partial<EventResponse>);

    try {
      await apiClient.patch(`/events/${id}`, data);
    } catch (err) {
      logger.warn('Failed to update event on server:', err);
      if (previousEvent) get().updateEvent(id, previousEvent);
      useToastStore.getState().addToast('error', 'Failed to update event on server, changes reverted');
    }
  },

}));
