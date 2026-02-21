import { create } from 'zustand';

export const useModuleStore = create((set, get) => ({
  // --- Todos ---
  todos: [],

  setTodos: (todos) => set({ todos }),

  addTodo: (todo) =>
    set((state) => ({
      todos: [todo, ...state.todos],
    })),

  updateTodo: (id, updates) =>
    set((state) => ({
      todos: state.todos.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  removeTodo: (id) =>
    set((state) => ({
      todos: state.todos.filter((t) => t.id !== id),
    })),

  // --- Events ---
  events: [],

  setEvents: (events) => set({ events }),

  addEvent: (event) =>
    set((state) => ({
      events: [event, ...state.events],
    })),

  updateEvent: (id, updates) =>
    set((state) => ({
      events: state.events.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    })),

  removeEvent: (id) =>
    set((state) => ({
      events: state.events.filter((e) => e.id !== id),
    })),

  // --- Memos ---
  memos: [],

  setMemos: (memos) => set({ memos }),

  addMemo: (memo) =>
    set((state) => ({
      memos: [memo, ...state.memos],
    })),

  updateMemo: (id, updates) =>
    set((state) => ({
      memos: state.memos.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),

  removeMemo: (id) =>
    set((state) => ({
      memos: state.memos.filter((m) => m.id !== id),
    })),
}));
