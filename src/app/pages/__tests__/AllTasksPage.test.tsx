import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AllTasksPage from '../AllTasksPage';
import {
  matchesTasksStatusFilter,
  type TasksStatusFilter,
} from '../../components/tasks/TasksHeader';

vi.mock('../../components/task-list/TaskListPage', () => ({
  default: ({ statusFilter }: { statusFilter: TasksStatusFilter }) => (
    <div>
      List <span data-testid="active-task-filter">{statusFilter}</span>
    </div>
  ),
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
  it('starts with open work only', () => {
    renderPage();

    expect(screen.getByText(/List/)).toBeInTheDocument();
    expect(screen.getByTestId('active-task-filter')).toHaveTextContent('active');
    expect(matchesTasksStatusFilter('pending', 'active')).toBe(true);
    expect(matchesTasksStatusFilter('in_progress', 'active')).toBe(true);
    expect(matchesTasksStatusFilter('completed', 'active')).toBe(false);
    expect(matchesTasksStatusFilter('cancelled', 'all')).toBe(true);
  });

  it('lands old kanban and graph preferences and links on the list', () => {
    localStorage.setItem('clawchat.tasksView', 'graph');
    const first = renderPage();
    expect(screen.getByText(/List/)).toBeInTheDocument();
    first.unmount();

    renderPage('/tasks?view=graph&project_id=project-1');
    expect(screen.getByText(/List/)).toBeInTheDocument();
    expect(screen.getByTestId('active-task-filter')).toHaveTextContent('active');
  });

  it('shows completed tasks too after a left swipe', () => {
    const { container } = renderPage();
    const page = container.querySelector('.cc-tasks-page');
    expect(page).not.toBeNull();

    fireEvent.touchStart(page!, { touches: [{ clientX: 240, clientY: 100 }] });
    fireEvent.touchEnd(page!, { changedTouches: [{ clientX: 120, clientY: 105 }] });

    expect(screen.getByTestId('active-task-filter')).toHaveTextContent('all');

    fireEvent.touchStart(page!, { touches: [{ clientX: 120, clientY: 100 }] });
    fireEvent.touchEnd(page!, { changedTouches: [{ clientX: 240, clientY: 105 }] });
    expect(screen.getByTestId('active-task-filter')).toHaveTextContent('active');
  });
});
