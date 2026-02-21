import { create } from 'zustand';
import apiClient from '../services/apiClient';
import { useAuthStore } from './useAuthStore';
import { useToastStore } from './useToastStore';
import type {
  TodoResponse,
  TodoCreate,
  EventResponse,
  EventCreate,
  MemoResponse,
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

  fetchTodos: (params?: Record<string, string>) => Promise<void>;
  fetchEvents: (params?: Record<string, string>) => Promise<void>;
  toggleTodoComplete: (id: string) => Promise<void>;
  createTodo: (data: TodoCreate) => Promise<TodoResponse>;
  createEvent: (data: EventCreate) => Promise<EventResponse>;
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
      apiClient.patch(`/todos/${id}`, { status: serverStatus }).catch(() => {});
    }
  },
  getKanbanStatus: (id) => {
    const { kanbanStatuses, todos } = get();
    if (kanbanStatuses[id]) return kanbanStatuses[id];
    const todo = todos.find((t) => t.id === id);
    return todo?.status ?? 'pending';
  },

  // --- Events --- (seeded with demo data)
  events: [
    { id: 'demo-e1', title: 'Sprint Planning', description: 'Review sprint goals and assign tasks', start_time: new Date(new Date().setHours(14, 0, 0, 0)).toISOString(), end_time: new Date(new Date().setHours(15, 0, 0, 0)).toISOString(), location: 'Zoom', created_at: now, updated_at: now },
    { id: 'demo-e2', title: 'Code Review Session', start_time: new Date(new Date().setHours(16, 30, 0, 0)).toISOString(), end_time: new Date(new Date().setHours(17, 0, 0, 0)).toISOString(), created_at: now, updated_at: now },
    { id: 'demo-e3', title: 'Team Standup', description: 'Daily sync', start_time: new Date(new Date().setHours(10, 0, 0, 0)).toISOString(), end_time: new Date(new Date().setHours(10, 15, 0, 0)).toISOString(), location: 'Discord', created_at: yesterday, updated_at: yesterday },
  ],
  setEvents: (events) => set({ events }),
  addEvent: (event) => set((state) => ({ events: [event, ...state.events] })),
  updateEvent: (id, updates) =>
    set((state) => ({
      events: state.events.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    })),
  removeEvent: (id) =>
    set((state) => ({ events: state.events.filter((e) => e.id !== id) })),

  // --- Memos ---
  memos: [
    { id: 'memo-1', content: 'ClawChat uses Zustand for state management — lightweight and no provider nesting needed.', tags: ['dev', 'architecture'], created_at: now, updated_at: now },
    { id: 'memo-2', content: 'Remember to test drag-and-drop on both Chrome and Firefox — they handle dataTransfer differently.', tags: ['testing'], created_at: yesterday, updated_at: yesterday },
    { id: 'memo-3', content: 'The server API uses JWT with refresh tokens. PIN auth is the primary method for single-user setups.', tags: ['security', 'api'], created_at: yesterday, updated_at: now },
  ],
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
    const { serverUrl } = useAuthStore.getState();
    if (!serverUrl) { return; } // No server configured — keep demo data
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/todos', { params });
      set({ todos: response.data?.items ?? [], isLoading: false, lastFetched: Date.now() });
    } catch {
      // Keep existing (demo) data on failure
      set({ isLoading: false });
    }
  },

  fetchEvents: async (params) => {
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/events', { params });
      set({ events: response.data?.items ?? [], isLoading: false, lastFetched: Date.now() });
    } catch {
      set({ isLoading: false });
    }
  },

  toggleTodoComplete: async (id) => {
    const { todos } = get();
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    const newStatus = todo.status === 'completed' ? 'pending' : 'completed';
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
      // Offline / no server — keep the optimistic update
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
    return response.data;
  },
}));
