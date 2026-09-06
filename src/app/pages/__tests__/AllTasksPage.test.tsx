import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AllTasksPage from '../AllTasksPage';
import {
  matchesTasksStatusFilter,
  TASK_STATUS_FILTERS,
  type TasksStatusFilter,
} from '../../components/kanban/TasksHeader';

vi.mock('../../components/kanban/KanbanBoard', () => ({
  default: ({ statusFilter }: { statusFilter: TasksStatusFilter }) => (
    <div data-testid="active-task-filter">{statusFilter}</div>
  ),
}));

vi.mock('../../components/task-list/TaskListPage', () => ({
  default: ({ statusFilter }: { statusFilter: TasksStatusFilter }) => (
    <div>
      List <span data-testid="active-task-filter">{statusFilter}</span>
    </div>
  ),
}));

vi.mock('../../components/task-graph/TaskGraphPage', () => ({
  default: () => <div>Graph</div>,
}));

beforeEach(() => localStorage.clear());

function renderPage(entry = '/tasks') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AllTasksPage />
    </MemoryRouter>,
  );
}

describe('AllTasksPage status flow', () => {
  it('starts with all active work and keeps All last', () => {
    renderPage();

    expect(screen.getByText(/List/)).toBeInTheDocument();
    expect(screen.getByTestId('active-task-filter')).toHaveTextContent('active');
    expect(TASK_STATUS_FILTERS).toEqual(['active', 'completed', 'all']);
    expect(matchesTasksStatusFilter('pending', 'active')).toBe(true);
    expect(matchesTasksStatusFilter('in_progress', 'active')).toBe(true);
    expect(matchesTasksStatusFilter('completed', 'active')).toBe(false);
    expect(matchesTasksStatusFilter('cancelled', 'all')).toBe(true);
  });

  it('migrates the old kanban default to the simpler list while keeping explicit kanban links', () => {
    localStorage.setItem('clawchat.tasksView', 'kanban');
    const first = renderPage();
    expect(screen.getByText(/List/)).toBeInTheDocument();
    first.unmount();

    renderPage('/tasks?view=kanban');
    expect(screen.getByTestId('active-task-filter')).toHaveTextContent('active');
    expect(screen.queryByText(/List/)).not.toBeInTheDocument();
  });

  it('moves through task statuses with horizontal swipes', () => {
    const { container } = renderPage();
    const page = container.querySelector('.cc-tasks-page');
    expect(page).not.toBeNull();

    fireEvent.touchStart(page!, { touches: [{ clientX: 240, clientY: 100 }] });
    fireEvent.touchEnd(page!, { changedTouches: [{ clientX: 120, clientY: 105 }] });

    expect(screen.getByTestId('active-task-filter')).toHaveTextContent('completed');
  });

  it('opens the graph requested by a project deep link', () => {
    renderPage('/tasks?view=graph&project_id=project-1');

    expect(screen.getByText('Graph')).toBeInTheDocument();
  });
});
