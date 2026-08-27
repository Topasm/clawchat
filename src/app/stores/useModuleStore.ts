import { create } from 'zustand';

interface ModuleState {
  isLoading: boolean;
  lastFetched: number | null;

  // Multi-select
  selectedTodoIds: Set<string>;
  toggleTodoSelection: (id: string) => void;
  selectAllTodos: (ids: string[]) => void;
  clearTodoSelection: () => void;

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
  setKanbanSort: (
    field: 'title' | 'priority' | 'due_date' | 'created_at' | 'updated_at' | 'sort_order',
    direction: 'asc' | 'desc',
  ) => void;
  clearKanbanFilters: () => void;
  toggleShowSubTasks: () => void;

  resetToDemo: () => void;
}

export const useModuleStore = create<ModuleState>()((set) => ({
  isLoading: false,
  lastFetched: null,

  // --- Multi-select ---
  selectedTodoIds: new Set<string>(),
  toggleTodoSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedTodoIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedTodoIds: next };
    }),
  selectAllTodos: (ids) => set({ selectedTodoIds: new Set(ids) }),
  clearTodoSelection: () => set({ selectedTodoIds: new Set<string>() }),

  resetToDemo: () => {
    set({
      selectedTodoIds: new Set<string>(),
      isLoading: false,
      lastFetched: null,
    });
  },

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
      const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
      return { kanbanFilters: { ...state.kanbanFilters, tags: next } };
    }),
  setKanbanSort: (field, direction) =>
    set((state) => ({
      kanbanFilters: { ...state.kanbanFilters, sortField: field, sortDirection: direction },
    })),
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
}));
