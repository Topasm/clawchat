import { create } from 'zustand';
import apiClient from '../services/apiClient';
import { useToastStore } from './useToastStore';
import { logger } from '../services/logger';
import { isDemoMode } from '../utils/helpers';
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

  memos: MemoResponse[];
  setMemos: (memos: MemoResponse[]) => void;
  addMemo: (memo: MemoResponse) => void;
  updateMemo: (id: string, updates: Partial<MemoResponse>) => void;
  removeMemo: (id: string) => void;

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
  fetchMemos: (params?: Record<string, string>) => Promise<void>;
  toggleTodoComplete: (id: string) => Promise<void>;
  createTodo: (data: TodoCreate) => Promise<TodoResponse>;
  createEvent: (data: EventCreate) => Promise<EventResponse>;
  createMemo: (data: MemoCreate) => Promise<MemoResponse>;
  deleteTodo: (id: string) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  deleteEventOccurrence: (eventId: string, date: string, mode: string) => Promise<void>;
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
  // Todo column — demo-3 and demo-4 are sub-tasks of demo-1
  { id: 'demo-1', title: 'Review ClawChat monorepo structure', status: 'pending', priority: 'high', due_date: now, tags: ['dev'], parent_id: null, sort_order: 0, created_at: now, updated_at: now },
  { id: 'demo-2', title: 'Set up Capacitor for Android build', status: 'pending', priority: 'medium', due_date: now, tags: ['mobile'], parent_id: null, sort_order: 1, created_at: now, updated_at: now },
  { id: 'demo-3', title: 'Write unit tests for platform abstraction', status: 'pending', priority: 'medium', due_date: now, tags: ['testing'], parent_id: 'demo-1', sort_order: 0, created_at: now, updated_at: now },
  { id: 'demo-4', title: 'Design bottom navigation for mobile layout', status: 'pending', priority: 'low', due_date: now, tags: ['design', 'mobile'], parent_id: 'demo-1', sort_order: 1, created_at: now, updated_at: now },
  { id: 'demo-6', title: 'Update API documentation for v2 endpoints', status: 'pending', priority: 'high', due_date: yesterday, tags: ['docs'], parent_id: null, sort_order: 2, created_at: yesterday, updated_at: yesterday },
  { id: 'demo-9', title: 'Add push notification support', status: 'pending', priority: 'medium', tags: ['feature', 'mobile'], parent_id: null, sort_order: 3, created_at: now, updated_at: now },
  { id: 'demo-10', title: 'Create onboarding tutorial flow', status: 'pending', priority: 'low', tags: ['ux'], parent_id: null, sort_order: 4, created_at: now, updated_at: now },
  // In Progress column (via kanbanStatuses override) — demo-16 is sub-task of demo-5
  { id: 'demo-5', title: 'Fix SSE reconnect on network change', status: 'pending', priority: 'urgent', due_date: yesterday, tags: ['bug'], parent_id: null, sort_order: 0, created_at: yesterday, updated_at: yesterday },
  { id: 'demo-16', title: 'Add exponential backoff to reconnect logic', status: 'pending', priority: 'high', tags: ['bug'], parent_id: 'demo-5', sort_order: 0, created_at: yesterday, updated_at: yesterday },
  { id: 'demo-11', title: 'Implement file upload in chat', status: 'pending', priority: 'high', due_date: now, tags: ['feature', 'chat'], parent_id: null, sort_order: 1, created_at: yesterday, updated_at: now },
  { id: 'demo-12', title: 'Migrate auth to JWT refresh tokens', status: 'pending', priority: 'high', tags: ['security'], parent_id: null, sort_order: 2, created_at: twoDaysAgo, updated_at: now },
  // Done column
  { id: 'demo-7', title: 'Implement dark mode toggle persistence', status: 'completed', priority: 'medium', tags: ['feature'], parent_id: null, sort_order: 0, created_at: yesterday, updated_at: now },
  { id: 'demo-8', title: 'Add Docker health check endpoint', status: 'completed', priority: 'low', tags: ['devops'], parent_id: null, sort_order: 1, created_at: yesterday, updated_at: now },
  { id: 'demo-13', title: 'Set up CI pipeline with GitHub Actions', status: 'completed', priority: 'high', tags: ['devops', 'ci'], parent_id: null, sort_order: 2, created_at: twoDaysAgo, updated_at: yesterday },
  { id: 'demo-14', title: 'Fix message ordering bug in chat', status: 'completed', priority: 'urgent', tags: ['bug', 'chat'], parent_id: null, sort_order: 3, created_at: twoDaysAgo, updated_at: yesterday },
  { id: 'demo-15', title: 'Add keyboard shortcuts for navigation', status: 'completed', priority: 'low', tags: ['ux'], parent_id: null, sort_order: 4, created_at: twoDaysAgo, updated_at: now },
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
  { id: 'memo-1', title: 'ClawChat Architecture', content: '## ClawChat Architecture\n\nClawChat uses **Zustand** for state management — lightweight and no provider nesting needed.\n\n### Key Benefits\n- Simple API\n- No boilerplate\n- Works great with TypeScript\n\n> *Lightweight and no provider nesting needed.*', tags: ['dev', 'architecture'], created_at: now, updated_at: now },
  { id: 'memo-2', title: 'Drag-and-drop testing', content: 'Remember to test drag-and-drop on both **Chrome** and **Firefox**.\n\n### Checklist\n- Chrome desktop\n- Firefox desktop\n- Safari (if available)', tags: ['testing'], created_at: yesterday, updated_at: yesterday },
  { id: 'memo-3', title: 'Server API auth', content: 'The server API uses **JWT** with refresh tokens.\n\n```\nAuthorization: Bearer <token>\n```\n\nSee the [FastAPI docs](https://fastapi.tiangolo.com/) for more.', tags: ['security', 'api'], created_at: yesterday, updated_at: now },
];

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

  kanbanStatuses: { 'demo-5': 'in_progress', 'demo-11': 'in_progress', 'demo-12': 'in_progress', 'demo-16': 'in_progress' } as Record<string, KanbanStatus>,
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
    if (isDemoMode()) {
      // Apply locally in demo mode
      const { todos } = get();
      if (update.delete) {
        set({ todos: todos.filter((t) => !update.ids.includes(t.id)) });
        useToastStore.getState().addToast('success', `${update.ids.length} tasks deleted`);
      } else {
        set({
          todos: todos.map((t) => {
            if (!update.ids.includes(t.id)) return t;
            const u: Partial<TodoResponse> = {};
            if (update.status) u.status = update.status;
            if (update.priority) u.priority = update.priority;
            if (update.tags) u.tags = update.tags;
            u.updated_at = new Date().toISOString();
            return { ...t, ...u };
          }),
        });
        useToastStore.getState().addToast('success', `${update.ids.length} tasks updated`);
      }
      set({ selectedTodoIds: new Set<string>() });
      return;
    }
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
    if (!isDemoMode()) {
      Object.entries(updates).forEach(([id, order]) => {
        apiClient.patch(`/todos/${id}`, { sort_order: order }).catch(() => {});
      });
    }
  },

  resetToDemo: () =>
    set({
      todos: DEMO_TODOS,
      events: DEMO_EVENTS,
      memos: DEMO_MEMOS,
      kanbanStatuses: { 'demo-5': 'in_progress', 'demo-11': 'in_progress', 'demo-12': 'in_progress', 'demo-16': 'in_progress' } as Record<string, KanbanStatus>,
      selectedTodoIds: new Set<string>(),
      isLoading: false,
      lastFetched: null,
    }),

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
    if (isDemoMode()) return; // Keep demo data
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/todos', { params });
      set({ todos: response.data?.items ?? response.data ?? [], kanbanStatuses: {}, isLoading: false, lastFetched: Date.now() });
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
        parent_id: data.parent_id ?? null,
        sort_order: data.sort_order ?? 0,
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
        title: data.content.slice(0, 50).trim(),
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

  deleteEventOccurrence: async (eventId, date, mode) => {
    if (mode === 'all') {
      // Delegate to deleteEvent for full series deletion
      await get().deleteEvent(eventId);
      return;
    }
    // For this_only and this_and_future, call the server endpoint
    if (!isDemoMode()) {
      try {
        await apiClient.delete(`/events/${eventId}/occurrences/${date}`, { params: { mode } });
        // Refresh events from server to reflect changes
        await get().fetchEvents();
        useToastStore.getState().addToast('success', 'Occurrence deleted');
      } catch (err) {
        logger.warn('Failed to delete event occurrence:', err);
        useToastStore.getState().addToast('error', 'Failed to delete occurrence');
      }
    } else {
      useToastStore.getState().addToast('success', 'Occurrence deleted');
    }
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
