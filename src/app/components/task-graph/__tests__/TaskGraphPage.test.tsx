import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskGraphPage from '../TaskGraphPage';

const mocks = vi.hoisted(() => ({
  graphProps: null as Record<string, unknown> | null,
}));

vi.mock('../../../hooks/queries', () => ({
  useTodosQuery: () => ({
    data: [
      { id: 'root-a', title: 'Project A', project_id: 'project-a', status: 'pending' },
      {
        id: 'question-a',
        title: 'E65 Question',
        project_id: 'project-a',
        parent_id: 'root-a',
        status: 'pending',
      },
      {
        id: 'step-a',
        title: 'E65a Step',
        project_id: 'project-a',
        parent_id: 'question-a',
        status: 'pending',
      },
      { id: 'root-b', title: 'Project B', project_id: 'project-b', status: 'pending' },
      {
        id: 'question-b',
        title: 'Q24k Question',
        project_id: 'project-b',
        parent_id: 'root-b',
        status: 'pending',
      },
      { id: 'standalone', title: 'Standalone', status: 'pending', inbox_state: 'none' },
    ],
  }),
  useTaskRelationshipsQuery: () => ({ data: [] }),
  useProjectsQuery: () => ({
    data: [
      { id: 'project-a', title: 'Project A', root_task_id: 'root-a' },
      { id: 'project-b', title: 'Project B', root_task_id: 'root-b' },
    ],
    isLoading: false,
  }),
}));

vi.mock('../../../stores/useModuleStore', () => ({
  useModuleStore: (selector: (state: unknown) => unknown) =>
    selector({ kanbanFilters: { searchQuery: '', tags: [] } }),
}));
vi.mock('../../../hooks/useKanbanFilters', () => ({ default: (todos: unknown[]) => todos }));
vi.mock('../../kanban/KanbanFilterBar', () => ({ default: () => null }));
vi.mock('../../kanban/TasksHeader', () => ({ default: () => null }));
vi.mock('../TaskGraph', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.graphProps = props;
    return <div data-testid="task-graph" />;
  },
}));

function LocationSearch() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <TaskGraphPage
        viewMode="graph"
        onViewModeChange={vi.fn()}
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
      />
      <LocationSearch />
    </MemoryRouter>,
  );
}

describe('TaskGraphPage project scope', () => {
  beforeEach(() => {
    mocks.graphProps = null;
  });

  it('filters to the URL project, hides its compatibility root, and starts in execution mode', () => {
    renderPage('/tasks?view=graph&project_id=project-a');

    expect(mocks.graphProps).toMatchObject({
      fixedProjectId: 'project-a',
      initialMode: 'execution',
      showPlanningAction: false,
    });
    expect((mocks.graphProps?.todos as Array<{ id: string }>).map((todo) => todo.id)).toEqual([
      'question-a',
      'step-a',
    ]);
  });

  it('keeps the selected project in the URL and updates the graph scope', async () => {
    renderPage('/tasks?view=graph&project_id=project-a');

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter graph by project' }), {
      target: { value: 'project-b' },
    });

    await waitFor(() =>
      expect(screen.getByTestId('location-search')).toHaveTextContent('project_id=project-b'),
    );
    expect((mocks.graphProps?.todos as Array<{ id: string }>).map((todo) => todo.id)).toEqual([
      'question-b',
    ]);
  });

  it('shows all tasks until a project is explicitly selected', () => {
    renderPage('/tasks?view=graph');

    expect(screen.getByRole('combobox', { name: 'Filter graph by project' })).toHaveValue('all');
    expect(mocks.graphProps).toMatchObject({
      fixedProjectId: 'all',
      showPlanningAction: false,
    });
    expect((mocks.graphProps?.todos as Array<{ id: string }>).map((todo) => todo.id)).toEqual([
      'root-a',
      'question-a',
      'step-a',
      'root-b',
      'question-b',
      'standalone',
    ]);
  });
});
