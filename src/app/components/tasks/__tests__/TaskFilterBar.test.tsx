import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskViewMenu, { focusTaskSearch } from '../TaskFilterBar';
import { useModuleStore } from '../../../stores/useModuleStore';

vi.mock('../../../hooks/queries', () => ({
  useTodosQuery: () => ({ data: [] }),
}));

describe('TaskViewMenu search', () => {
  beforeEach(() => {
    useModuleStore.getState().clearKanbanFilters();
  });

  it('shows the search box in the header without opening the View menu', () => {
    render(<TaskViewMenu statusFilter="active" onStatusFilterChange={() => undefined} />);

    const search = screen.getByRole('searchbox', { name: 'Search tasks' });
    expect(search).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'rent' } });
    expect(useModuleStore.getState().kanbanFilters.searchQuery).toBe('rent');
  });

  it('keeps search out of the View menu and sends / to the header box', () => {
    render(<TaskViewMenu statusFilter="active" onStatusFilterChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /View/ }));
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);

    act(() => focusTaskSearch());
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveFocus();
  });
});
