import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectOverviewResponse } from '../../../types/api';
import ProjectPlan from '../ProjectPlan';

vi.mock('../../../hooks/queries', () => ({
  resolveExecutionSkillId: vi.fn(),
  useSkillsQuery: () => ({ data: { skills: [] } }),
  useStartReadyTaskExecution: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTaskGraphInsightsQuery: () => ({ data: { nodes: [] }, isLoading: false }),
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
