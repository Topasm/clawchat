import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../../stores/useChatStore';
import type { ProjectOverviewResponse, TodoResponse } from '../../../types/api';
import ProjectPlan from '../ProjectPlan';

const execution = vi.hoisted(() => ({ start: vi.fn(), open: vi.fn() }));
vi.mock('../../../hooks/useOpenRunThread', () => ({ default: () => execution.open }));

vi.mock('../../../hooks/queries', () => ({
  resolveExecutionSkillId: () => 'execute',
  useSkillsQuery: () => ({ data: { skills: [] } }),
  useStartReadyTaskExecution: () => ({ mutateAsync: execution.start, isPending: false }),
  useTaskGraphInsightsQuery: () => ({
    data: { nodes: [{ task_id: 'ready-task', is_ready: true, is_container: false }] },
    isLoading: false,
  }),
  useTaskRelationshipsQuery: () => ({ data: [] }),
}));

vi.mock('../../task-graph/TaskGraph', () => ({
  default: () => <div>Task graph</div>,
}));

vi.mock('../../task-graph/TaskGraphProposalDialog', () => ({
  default: () => <div>Graph proposal</div>,
}));

const project = {
  id: 'project-p0-r',
  title: 'P0-R Semantic referent binding',
  goal: 'Resolve the semantic referent.',
  description: '/home/research/E65.md',
  execution_instructions: null,
  status: 'active',
  deadline: null,
  root_task_id: 'todo-root',
  graph_revision: 1,
  default_execution_provider: 'builtin',
  default_execution_model: null,
  execution_workspace_path: null,
  execution_workspace_isolation: 'local',
  execution_base_branch: null,
  created_at: '2026-09-04T00:00:00Z',
  updated_at: '2026-09-04T00:00:00Z',
  task_count: 0,
  completed_task_count: 0,
  conversation_id: null,
  ready_count: 0,
  blocked_count: 0,
  at_risk_count: 0,
  running_agent_count: 0,
  pending_review_count: 0,
  critical_path_minutes: 0,
} as ProjectOverviewResponse;

function LocationSearch() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('ProjectPlan', () => {
  beforeEach(() => useChatStore.setState({ projectPlanSelections: {} }));

  it('restores view and task after remount, without applying them to another project', () => {
    const todos = [
      {
        id: 'ready-task',
        title: 'Saved task',
        status: 'pending',
        parent_id: 'todo-root',
      } as TodoResponse,
    ];
    const mount = (id: string) =>
      render(
        <MemoryRouter>
          <ProjectPlan project={{ ...project, id }} todos={todos} onDiscussTask={vi.fn()} />
        </MemoryRouter>,
      );
    const first = mount(project.id);
    fireEvent.click(screen.getByRole('button', { name: /^Saved task\s*Ready$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
    first.unmount();
    const restored = mount(project.id);
    expect(screen.getByRole('button', { name: 'Flow' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Selected task actions')).toHaveTextContent('Saved task');
    restored.unmount();
    mount('other-project');
    expect(screen.getByRole('button', { name: 'Outline' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Selected task actions')).not.toBeInTheDocument();
  });
  it('opens the returned run after explicitly starting a Ready task', async () => {
    execution.start.mockResolvedValue({ run_id: 'new-run' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MemoryRouter>
        <ProjectPlan
          project={project}
          todos={[
            {
              id: 'ready-task',
              title: 'Ready task',
              status: 'pending',
              parent_id: 'todo-root',
            } as TodoResponse,
          ]}
          onDiscussTask={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Ready task\s*Ready$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Run agent' }));
    await waitFor(() =>
      expect(execution.open).toHaveBeenCalledWith('new-run', `${project.title} › Ready task`),
    );
    expect(execution.start).toHaveBeenCalledWith({
      todoId: 'ready-task',
      skillId: 'execute',
      executionProvider: 'builtin',
      model: null,
    });
    confirm.mockRestore();
  });
  it('opens the task graph scoped to the current project', () => {
    render(
      <MemoryRouter initialEntries={[`/projects/${project.id}`]}>
        <ProjectPlan project={project} todos={[]} onDiscussTask={vi.fn()} />
        <LocationSearch />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open graph' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      `/tasks?view=graph&project_id=${project.id}`,
    );
  });
});
