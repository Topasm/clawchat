import { create } from 'zustand';
import apiClient from '../services/apiClient';
import { useAuthStore } from './useAuthStore';
import { useToastStore } from './useToastStore';
import { logger } from '../services/logger';
import type {
  TodoResponse,
  TodoCreate,
  TodoUpdate,
  EventResponse,
  EventCreate,
  EventUpdate,
  MemoResponse,
  MemoCreate,
  MemoUpdate,
  KanbanStatus,
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

  memos: MemoResponse[];
  setMemos: (memos: MemoResponse[]) => void;
  addMemo: (memo: MemoResponse) => void;
  updateMemo: (id: string, updates: Partial<MemoResponse>) => void;
  removeMemo: (id: string) => void;

  // Kanban filters
  kanbanFilters: {
    searchQuery: string;
    priorities: string[];
    tags: string[];
    sortField: 'title' | 'priority' | 'due_date' | 'created_at';
    sortDirection: 'asc' | 'desc';
  };
  setKanbanSearchQuery: (query: string) => void;
  toggleKanbanPriorityFilter: (priority: string) => void;
  toggleKanbanTagFilter: (tag: string) => void;
  setKanbanSort: (field: 'title' | 'priority' | 'due_date' | 'created_at', direction: 'asc' | 'desc') => void;
  clearKanbanFilters: () => void;

  // Async actions
  fetchTodos: (params?: Record<string, string>) => Promise<void>;
  fetchEvents: (params?: Record<string, string>) => Promise<void>;
  fetchMemos: (params?: Record<string, string>) => Promise<void>;
  toggleTodoComplete: (id: string) => Promise<void>;
  createTodo: (data: TodoCreate) => Promise<TodoResponse>;
  createEvent: (data: EventCreate) => Promise<EventResponse>;
  createMemo: (data: MemoCreate) => Promise<MemoResponse>;
  deleteTodo: (id: string) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  deleteMemo: (id: string) => Promise<void>;
  serverUpdateTodo: (id: string, data: TodoUpdate) => Promise<void>;
  serverUpdateEvent: (id: string, data: EventUpdate) => Promise<void>;
  serverUpdateMemo: (id: string, data: MemoUpdate) => Promise<void>;
}

// Demo seed data shown when the backend is not running
const now = new Date().toISOString();
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
const DEMO_TODOS: TodoResponse[] = [
  // Todo column
  { id: 'demo-1', title: 'Review ClawChat monorepo structure', status: 'pending', priority: 'high', due_date: now, tags: ['dev'], created_at: now, updated_at: now },
  { id: 'demo-2', title: 'Set up Capacitor for Android build', status: 'pending', priority: 'medium', due_date: now, tags: ['mobile'], created_at: now, updated_at: now },
  { id: 'demo-3', title: 'Write unit tests for platform abstraction', status: 'pending', priority: 'medium', due_date: now, tags: ['testing'], created_at: now, updated_at: now },
  { id: 'demo-4', title: 'Design bottom navigation for mobile layout', status: 'pending', priority: 'low', due_date: now, tags: ['design', 'mobile'], created_at: now, updated_at: now },
  { id: 'demo-6', title: 'Update API documentation for v2 endpoints', status: 'pending', priority: 'high', due_date: yesterday, tags: ['docs'], created_at: yesterday, updated_at: yesterday },
  { id: 'demo-9', title: 'Add push notification support', status: 'pending', priority: 'medium', tags: ['feature', 'mobile'], created_at: now, updated_at: now },
  { id: 'demo-10', title: 'Create onboarding tutorial flow', status: 'pending', priority: 'low', tags: ['ux'], created_at: now, updated_at: now },
  // In Progress column (via kanbanStatuses override)
  { id: 'demo-5', title: 'Fix SSE reconnect on network change', status: 'pending', priority: 'urgent', due_date: yesterday, tags: ['bug'], created_at: yesterday, updated_at: yesterday },
  { id: 'demo-11', title: 'Implement file upload in chat', status: 'pending', priority: 'high', due_date: now, tags: ['feature', 'chat'], created_at: yesterday, updated_at: now },
  { id: 'demo-12', title: 'Migrate auth to JWT refresh tokens', status: 'pending', priority: 'high', tags: ['security'], created_at: twoDaysAgo, updated_at: now },
  // Done column
  { id: 'demo-7', title: 'Implement dark mode toggle persistence', status: 'completed', priority: 'medium', tags: ['feature'], created_at: yesterday, updated_at: now },
  { id: 'demo-8', title: 'Add Docker health check endpoint', status: 'completed', priority: 'low', tags: ['devops'], created_at: yesterday, updated_at: now },
  { id: 'demo-13', title: 'Set up CI pipeline with GitHub Actions', status: 'completed', priority: 'high', tags: ['devops', 'ci'], created_at: twoDaysAgo, updated_at: yesterday },
  { id: 'demo-14', title: 'Fix message ordering bug in chat', status: 'completed', priority: 'urgent', tags: ['bug', 'chat'], created_at: twoDaysAgo, updated_at: yesterday },
  { id: 'demo-15', title: 'Add keyboard shortcuts for navigation', status: 'completed', priority: 'low', tags: ['ux'], created_at: twoDaysAgo, updated_at: now },
];

const DEMO_EVENTS: EventResponse[] = [
  { id: 'demo-e1', title: 'Sprint Planning', description: 'Review sprint goals and assign tasks', start_time: new Date(new Date().setHours(14, 0, 0, 0)).toISOString(), end_time: new Date(new Date().setHours(15, 0, 0, 0)).toISOString(), location: 'Zoom', tags: ['work'], created_at: now, updated_at: now },
  { id: 'demo-e2', title: 'Code Review Session', start_time: new Date(new Date().setHours(16, 30, 0, 0)).toISOString(), end_time: new Date(new Date().setHours(17, 0, 0, 0)).toISOString(), tags: ['dev'], created_at: now, updated_at: now },
  { id: 'demo-e3', title: 'Team Standup', description: 'Daily sync', start_time: new Date(new Date().setHours(10, 0, 0, 0)).toISOString(), end_time: new Date(new Date().setHours(10, 15, 0, 0)).toISOString(), location: 'Discord', tags: ['work'], created_at: yesterday, updated_at: yesterday },
  { id: 'demo-e4', title: 'Dentist Appointment', start_time: new Date(Date.now() + 86_400_000 * 2).toISOString().replace(/T\d{2}/, 'T09'), end_time: new Date(Date.now() + 86_400_000 * 2).toISOString().replace(/T\d{2}/, 'T10'), location: 'Downtown Dental', is_all_day: false, tags: ['personal'], created_at: now, updated_at: now },
  { id: 'demo-e5', title: 'Team Offsite', is_all_day: true, start_time: new Date(Date.now() + 86_400_000 * 4).toISOString(), tags: ['work'], created_at: now, updated_at: now },
  { id: 'demo-e6', title: 'Lunch with Sarah', start_time: new Date(Date.now() - 86_400_000).toISOString().replace(/T\d{2}:\d{2}/, 'T12:00'), end_time: new Date(Date.now() - 86_400_000).toISOString().replace(/T\d{2}:\d{2}/, 'T13:00'), location: 'Cafe Roma', tags: ['personal'], created_at: yesterday, updated_at: yesterday },
];

const DEMO_MEMOS: MemoResponse[] = [
  { id: 'memo-1', content: 'ClawChat uses Zustand for state management — lightweight and no provider nesting needed.', tags: ['dev', 'architecture'], created_at: now, updated_at: now },
  { id: 'memo-2', content: 'Remember to test drag-and-drop on both Chrome and Firefox — they handle dataTransfer differently.', tags: ['testing'], created_at: yesterday, updated_at: yesterday },
  { id: 'memo-3', content: 'The server API uses JWT with refresh tokens. PIN auth is the primary method for single-user setups.', tags: ['security', 'api'], created_at: yesterday, updated_at: now },
];

/** Helper: returns true when no server is configured (demo mode) */
function isDemoMode(): boolean {
  return !useAuthStore.getState().serverUrl;
}

const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();

export const useModuleStore = create<ModuleState>()((set, get) => ({
  isLoading: false,
  lastFetched: null,

  // --- Todos --- (seeded with demo data)
  todos: DEMO_TODOS,
  setTodos: (todos) => set({ todos }),
  addTodo: (todo) => set((state) => ({ todos: [todo, ...state.todos] })),
  updateTodo: (id, updates) =>
    set((state) => ({
      todos: state.todos.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  removeTodo: (id) =>
    set((state) => ({ todos: state.todos.filter((t) => t.id !== id) })),

  kanbanStatuses: { 'demo-5': 'in_progress', 'demo-11': 'in_progress', 'demo-12': 'in_progress' },
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
      if (!isDemoMode()) {
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
    }
  },
  getKanbanStatus: (id) => {
    const { kanbanStatuses, todos } = get();
    if (kanbanStatuses[id]) return kanbanStatuses[id];
    const todo = todos.find((t) => t.id === id);
    return todo?.status ?? 'pending';
  },

  // --- Events --- (seeded with demo data across several days for calendar view)
  events: DEMO_EVENTS,
  setEvents: (events) => set({ events }),
  addEvent: (event) => set((state) => ({ events: [event, ...state.events] })),
  updateEvent: (id, updates) =>
    set((state) => ({
      events: state.events.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    })),
  removeEvent: (id) =>
    set((state) => ({ events: state.events.filter((e) => e.id !== id) })),

  // --- Memos ---
  memos: DEMO_MEMOS,
  setMemos: (memos) => set({ memos }),
  addMemo: (memo) => set((state) => ({ memos: [memo, ...state.memos] })),
  updateMemo: (id, updates) =>
    set((state) => ({
      memos: state.memos.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  removeMemo: (id) =>
    set((state) => ({ memos: state.memos.filter((m) => m.id !== id) })),

  // --- Kanban filters ---
  kanbanFilters: {
    searchQuery: '',
    priorities: [],
    tags: [],
    sortField: 'created_at' as const,
    sortDirection: 'desc' as const,
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
      },
    }),

  // --- Async actions ---

  fetchTodos: async (params) => {
    if (isDemoMode()) return; // Keep demo data
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/todos', { params });
      set({ todos: response.data?.items ?? response.data ?? [], isLoading: false, lastFetched: Date.now() });
    } catch {
      // Keep existing (demo) data on failure
      set({ isLoading: false });
    }
  },

  fetchEvents: async (params) => {
    if (isDemoMode()) return;
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/events', { params });
      set({ events: response.data?.items ?? response.data ?? [], isLoading: false, lastFetched: Date.now() });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchMemos: async (params) => {
    if (isDemoMode()) return;
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/memos', { params });
      set({ memos: response.data?.items ?? response.data ?? [], isLoading: false, lastFetched: Date.now() });
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
    if (!isDemoMode()) {
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
    }
  },

  createTodo: async (data) => {
    if (isDemoMode()) {
      // Create locally in demo mode
      const localTodo: TodoResponse = {
        id: `local-${Date.now()}`,
        title: data.title,
        description: data.description,
        status: 'pending',
        priority: data.priority,
        due_date: data.due_date,
        tags: data.tags,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      get().addTodo(localTodo);
      useToastStore.getState().addToast('success', 'Task created');
      return localTodo;
    }
    const response = await apiClient.post('/todos', data);
    get().addTodo(response.data);
    useToastStore.getState().addToast('success', 'Task created');
    return response.data;
  },

  createEvent: async (data) => {
    if (isDemoMode()) {
      const localEvent: EventResponse = {
        id: `local-${Date.now()}`,
        title: data.title,
        description: data.description,
        start_time: data.start_time,
        end_time: data.end_time,
        location: data.location,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      get().addEvent(localEvent);
      useToastStore.getState().addToast('success', 'Event created');
      return localEvent;
    }
    const response = await apiClient.post('/events', data);
    get().addEvent(response.data);
    useToastStore.getState().addToast('success', 'Event created');
    return response.data;
  },

  createMemo: async (data) => {
    if (isDemoMode()) {
      const localMemo: MemoResponse = {
        id: `local-${Date.now()}`,
        content: data.content,
        tags: data.tags,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      get().addMemo(localMemo);
      useToastStore.getState().addToast('success', 'Memo saved');
      return localMemo;
    }
    const response = await apiClient.post('/memos', data);
    get().addMemo(response.data);
    useToastStore.getState().addToast('success', 'Memo saved');
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
      if (!isDemoMode()) {
        try {
          await apiClient.delete(`/todos/${id}`);
        } catch (err) {
          logger.warn('Failed to delete todo on server:', err);
          get().addTodo(existing);
          if (savedKanbanStatus) get().setKanbanStatus(id, savedKanbanStatus);
          useToastStore.getState().addToast('error', 'Failed to delete task on server');
        }
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
      if (!isDemoMode()) {
        try {
          await apiClient.delete(`/events/${id}`);
        } catch (err) {
          logger.warn('Failed to delete event on server:', err);
          get().addEvent(existing);
          useToastStore.getState().addToast('error', 'Failed to delete event on server');
        }
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

  deleteMemo: async (id) => {
    const { memos } = get();
    const existing = memos.find((m) => m.id === id);
    if (!existing) return;

    get().removeMemo(id);

    const timeoutId = setTimeout(async () => {
      pendingDeletes.delete(id);
      if (!isDemoMode()) {
        try {
          await apiClient.delete(`/memos/${id}`);
        } catch (err) {
          logger.warn('Failed to delete memo on server:', err);
          get().addMemo(existing);
          useToastStore.getState().addToast('error', 'Failed to delete memo on server');
        }
      }
    }, 5000);
    pendingDeletes.set(id, timeoutId);

    useToastStore.getState().addToast('success', 'Memo deleted', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(timeoutId);
          pendingDeletes.delete(id);
          get().addMemo(existing);
        },
      },
    });
  },

  serverUpdateTodo: async (id, data) => {
    // Capture previous state for rollback
    const previousTodo = get().todos.find((t) => t.id === id);
    // Optimistic update
    get().updateTodo(id, { ...data, updated_at: new Date().toISOString() } as Partial<TodoResponse>);

    if (!isDemoMode()) {
      try {
        await apiClient.patch(`/todos/${id}`, data);
      } catch (err) {
        logger.warn('Failed to update todo on server:', err);
        // Rollback to previous state
        if (previousTodo) get().updateTodo(id, previousTodo);
        useToastStore.getState().addToast('error', 'Failed to update task on server, changes reverted');
      }
    }
  },

  serverUpdateEvent: async (id, data) => {
    // Capture previous state for rollback
    const previousEvent = get().events.find((e) => e.id === id);
    // Optimistic update
    get().updateEvent(id, { ...data, updated_at: new Date().toISOString() } as Partial<EventResponse>);

    if (!isDemoMode()) {
      try {
        await apiClient.patch(`/events/${id}`, data);
      } catch (err) {
        logger.warn('Failed to update event on server:', err);
        // Rollback to previous state
        if (previousEvent) get().updateEvent(id, previousEvent);
        useToastStore.getState().addToast('error', 'Failed to update event on server, changes reverted');
      }
    }
  },

  serverUpdateMemo: async (id, data) => {
    // Capture previous state for rollback
    const previousMemo = get().memos.find((m) => m.id === id);
    // Optimistic update
    get().updateMemo(id, { ...data, updated_at: new Date().toISOString() } as Partial<MemoResponse>);

    if (!isDemoMode()) {
      try {
        await apiClient.patch(`/memos/${id}`, data);
      } catch (err) {
        logger.warn('Failed to update memo on server:', err);
        // Rollback to previous state
        if (previousMemo) get().updateMemo(id, previousMemo);
        useToastStore.getState().addToast('error', 'Failed to update memo on server, changes reverted');
      }
    }
  },
}));
