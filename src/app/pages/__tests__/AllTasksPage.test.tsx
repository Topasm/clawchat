import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AllTasksPage from '../AllTasksPage';
import { TASK_STATUS_FILTERS, type TasksStatusFilter } from '../../components/kanban/TasksHeader';

vi.mock('../../components/kanban/KanbanBoard', () => ({
  default: ({ statusFilter }: { statusFilter: TasksStatusFilter }) => (
    <div data-testid="active-task-filter">{statusFilter}</div>
  ),
}));

vi.mock('../../components/task-list/TaskListPage', () => ({
  default: () => <div>List</div>,
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
  it('starts with in-progress work and keeps All last', () => {
    renderPage();

    expect(screen.getByTestId('active-task-filter')).toHaveTextContent('in_progress');
    expect(TASK_STATUS_FILTERS).toEqual([
      'in_progress',
      'pending',
      'completed',
      'cancelled',
      'all',
    ]);
  });

  it('moves through task statuses with horizontal swipes', () => {
    const { container } = renderPage();
    const page = container.querySelector('.cc-tasks-page');
    expect(page).not.toBeNull();

    fireEvent.touchStart(page!, { touches: [{ clientX: 240, clientY: 100 }] });
    fireEvent.touchEnd(page!, { changedTouches: [{ clientX: 120, clientY: 105 }] });

    expect(screen.getByTestId('active-task-filter')).toHaveTextContent('pending');
  });

  it('opens the graph requested by a project deep link', () => {
    renderPage('/tasks?view=graph&project_id=project-1');

    expect(screen.getByText('Graph')).toBeInTheDocument();
  });
});
