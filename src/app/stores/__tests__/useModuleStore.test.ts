import { beforeEach, describe, expect, it } from 'vitest';
import { useModuleStore } from '../useModuleStore';

describe('useModuleStore', () => {
  beforeEach(() => {
    useModuleStore.getState().clearKanbanFilters();
    useModuleStore.getState().resetToDemo();
  });

  describe('task selection', () => {
    it('toggles a selected task', () => {
      useModuleStore.getState().toggleTodoSelection('task-1');
      expect(useModuleStore.getState().selectedTodoIds.has('task-1')).toBe(true);

      useModuleStore.getState().toggleTodoSelection('task-1');
      expect(useModuleStore.getState().selectedTodoIds.has('task-1')).toBe(false);
    });

    it('selects and clears multiple tasks', () => {
      useModuleStore.getState().selectAllTodos(['task-1', 'task-2', 'task-3']);
      expect([...useModuleStore.getState().selectedTodoIds]).toEqual([
        'task-1',
        'task-2',
        'task-3',
      ]);

      useModuleStore.getState().clearTodoSelection();
      expect(useModuleStore.getState().selectedTodoIds.size).toBe(0);
    });
  });

  describe('kanban filters', () => {
    it('updates search, priority, tag, sort, and subtask filters', () => {
      const store = useModuleStore.getState();
      store.setKanbanSearchQuery('graph');
      store.toggleKanbanPriorityFilter('high');
      store.toggleKanbanTagFilter('frontend');
      store.setKanbanSort('due_date', 'asc');
      store.toggleShowSubTasks();

      expect(useModuleStore.getState().kanbanFilters).toEqual({
        searchQuery: 'graph',
        priorities: ['high'],
        tags: ['frontend'],
        sortField: 'due_date',
        sortDirection: 'asc',
        showSubTasks: true,
      });
    });

    it('toggles priority and tag filters off', () => {
      const store = useModuleStore.getState();
      store.toggleKanbanPriorityFilter('high');
      store.toggleKanbanPriorityFilter('high');
      store.toggleKanbanTagFilter('frontend');
      store.toggleKanbanTagFilter('frontend');

      expect(useModuleStore.getState().kanbanFilters.priorities).toEqual([]);
      expect(useModuleStore.getState().kanbanFilters.tags).toEqual([]);
    });

    it('clears all filters', () => {
      const store = useModuleStore.getState();
      store.setKanbanSearchQuery('graph');
      store.toggleKanbanPriorityFilter('urgent');
      store.toggleKanbanTagFilter('backend');
      store.setKanbanSort('title', 'asc');
      store.toggleShowSubTasks();

      store.clearKanbanFilters();

      expect(useModuleStore.getState().kanbanFilters).toEqual({
        searchQuery: '',
        priorities: [],
        tags: [],
        sortField: 'created_at',
        sortDirection: 'desc',
        showSubTasks: false,
      });
    });
  });

  it('resetToDemo clears transient module UI state', () => {
    useModuleStore.getState().selectAllTodos(['task-1', 'task-2']);
    useModuleStore.setState({ isLoading: true, lastFetched: 123 });

    useModuleStore.getState().resetToDemo();

    const state = useModuleStore.getState();
    expect(state.selectedTodoIds.size).toBe(0);
    expect(state.isLoading).toBe(false);
    expect(state.lastFetched).toBeNull();
  });
});
