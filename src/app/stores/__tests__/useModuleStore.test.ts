import { beforeEach, describe, expect, it } from 'vitest';
import { useModuleStore } from '../useModuleStore';

describe('useModuleStore', () => {
  beforeEach(() => {
    useModuleStore.getState().clearKanbanFilters();
    useModuleStore.getState().resetToDemo();
  });

  describe('kanban filters', () => {
    it('updates search, tag, sort, and subtask filters', () => {
      const store = useModuleStore.getState();
      store.setKanbanSearchQuery('graph');
      store.toggleKanbanTagFilter('frontend');
      store.setKanbanSort('due_date', 'asc');

      expect(useModuleStore.getState().kanbanFilters).toEqual({
        searchQuery: 'graph',
        tags: ['frontend'],
        sortField: 'due_date',
        sortDirection: 'asc',
      });
    });

    it('toggles tag filters off', () => {
      const store = useModuleStore.getState();
      store.toggleKanbanTagFilter('frontend');
      store.toggleKanbanTagFilter('frontend');

      expect(useModuleStore.getState().kanbanFilters.tags).toEqual([]);
    });

    it('clears all filters', () => {
      const store = useModuleStore.getState();
      store.setKanbanSearchQuery('graph');
      store.toggleKanbanTagFilter('backend');
      store.setKanbanSort('title', 'asc');

      store.clearKanbanFilters();

      expect(useModuleStore.getState().kanbanFilters).toEqual({
        searchQuery: '',
        tags: [],
        sortField: 'created_at',
        sortDirection: 'desc',
      });
    });
  });

  it('resetToDemo clears transient module UI state', () => {
    useModuleStore.setState({ isLoading: true, lastFetched: 123 });

    useModuleStore.getState().resetToDemo();

    const state = useModuleStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.lastFetched).toBeNull();
  });
});
