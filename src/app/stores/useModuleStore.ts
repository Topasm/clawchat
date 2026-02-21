import { create } from 'zustand';
import apiClient from '../services/apiClient';
import type {
  TodoResponse,
  TodoCreate,
  EventResponse,
  EventCreate,
  MemoResponse,
} from '../types/api';

interface ModuleState {
  isLoading: boolean;
  lastFetched: number | null;

  todos: TodoResponse[];
  setTodos: (todos: TodoResponse[]) => void;
  addTodo: (todo: TodoResponse) => void;
  updateTodo: (id: string, updates: Partial<TodoResponse>) => void;
  removeTodo: (id: string) => void;

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

  fetchTodos: (params?: Record<string, string>) => Promise<void>;
  fetchEvents: (params?: Record<string, string>) => Promise<void>;
  toggleTodoComplete: (id: string) => Promise<void>;
  createTodo: (data: TodoCreate) => Promise<TodoResponse>;
  createEvent: (data: EventCreate) => Promise<EventResponse>;
}

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

  // --- Memos ---
  memos: [],
  setMemos: (memos) => set({ memos }),
  addMemo: (memo) => set((state) => ({ memos: [memo, ...state.memos] })),
  updateMemo: (id, updates) =>
    set((state) => ({
      memos: state.memos.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  removeMemo: (id) =>
    set((state) => ({ memos: state.memos.filter((m) => m.id !== id) })),

  // --- Async actions ---
  fetchTodos: async (params) => {
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/todos', { params });
      set({ todos: response.data?.items ?? [], isLoading: false, lastFetched: Date.now() });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchEvents: async (params) => {
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/events', { params });
      set({ events: response.data?.items ?? [], isLoading: false, lastFetched: Date.now() });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  toggleTodoComplete: async (id) => {
    const { todos } = get();
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    const newStatus = todo.status === 'completed' ? 'pending' : 'completed';
    set((state) => ({
      todos: state.todos.map((t) => (t.id === id ? { ...t, status: newStatus } : t)),
    }));
    try {
      await apiClient.patch(`/todos/${id}`, { status: newStatus });
    } catch (error) {
      set((state) => ({
        todos: state.todos.map((t) => (t.id === id ? { ...t, status: todo.status } : t)),
      }));
      throw error;
    }
  },

  createTodo: async (data) => {
    const response = await apiClient.post('/todos', data);
    get().addTodo(response.data);
    return response.data;
  },

  createEvent: async (data) => {
    const response = await apiClient.post('/events', data);
    get().addEvent(response.data);
    return response.data;
  },
}));
