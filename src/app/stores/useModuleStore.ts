import { create } from 'zustand';

interface ModuleState {
  isLoading: boolean;
  lastFetched: number | null;

  // Task list filters (the store key predates the Kanban board's removal)
  kanbanFilters: {
    searchQuery: string;
    tags: string[];
    sortField: 'title' | 'due_date' | 'created_at' | 'updated_at' | 'sort_order';
    sortDirection: 'asc' | 'desc';
    /** Only tasks waiting on an unfinished prerequisite. */
    blockedOnly: boolean;
  };
  setKanbanSearchQuery: (query: string) => void;
  setKanbanBlockedOnly: (blockedOnly: boolean) => void;
  toggleKanbanTagFilter: (tag: string) => void;
  setKanbanSort: (
    field: 'title' | 'due_date' | 'created_at' | 'updated_at' | 'sort_order',
    direction: 'asc' | 'desc',
  ) => void;
  clearKanbanFilters: () => void;

  resetToDemo: () => void;
}

export const useModuleStore = create<ModuleState>()((set) => ({
  isLoading: false,
  lastFetched: null,

  resetToDemo: () => {
    set({ isLoading: false, lastFetched: null });
  },

  // --- Task list filters ---
  kanbanFilters: {
    searchQuery: '',
    tags: [],
    // Nearest deadline first; tasks without one go last.
    sortField: 'due_date' as const,
    sortDirection: 'asc' as const,
    blockedOnly: false,
  },
  setKanbanSearchQuery: (query) =>
    set((state) => ({ kanbanFilters: { ...state.kanbanFilters, searchQuery: query } })),
  setKanbanBlockedOnly: (blockedOnly) =>
    set((state) => ({ kanbanFilters: { ...state.kanbanFilters, blockedOnly } })),
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
        tags: [],
        sortField: 'due_date',
        sortDirection: 'asc',
        blockedOnly: false,
      },
    }),
}));
