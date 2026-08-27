import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskGraphInsightNode, TaskGraphInsightsResponse } from '../../../types/api';
import { TaskGraphHealthPanel, TaskGraphNodeInsightPanel } from '../TaskGraphInsightsPanel';

function node(taskId: string, overrides: Partial<TaskGraphInsightNode> = {}): TaskGraphInsightNode {
  return {
    task_id: taskId,
    title: taskId,
    status: 'pending',
    parent_id: null,
    scope_role: 'global',
    execution_state: 'pending',
    estimated_minutes: null,
    due_date: null,
    dependency_ids: [],
    direct_blocker_ids: [],
    transitive_blocker_ids: [],
    transitive_blocker_count: 0,
    transitive_blockers_truncated: false,
    downstream_task_ids: [],
    downstream_count: 0,
    downstream_truncated: false,
    is_container: false,
    is_ready: false,
    is_blocked: false,
    is_unschedulable: false,
    is_on_critical_path: false,
    remaining_path_minutes: null,
    remaining_path_known_minutes: 0,
    estimate_complete: false,
    due_risk: 'none',
    due_slack_minutes: null,
    ...overrides,
  };
}

const response: TaskGraphInsightsResponse = {
  graph_revision: 8,
  generated_at: '2026-08-27T03:00:00Z',
  scope: {
    root_task_id: null,
    task_count: 3,
    primary_task_count: 3,
    relationship_count: 2,
    prerequisite_task_count: 0,
  },
  nodes: [],
  summary: {
    active_count: 3,
    pending_count: 3,
    in_progress_count: 0,
    completed_count: 0,
    cancelled_count: 0,
    ready_count: 1,
    blocked_count: 1,
    at_risk_count: 1,
    overdue_count: 0,
    orphan_count: 0,
    isolated_count: 0,
    critical_path_task_ids: ['blocker', 'selected'],
    critical_path_minutes: null,
    critical_path_known_minutes: 45,
    critical_path_estimate_complete: false,
    unknown_estimate_task_ids: ['selected'],
    unschedulable_task_ids: [],
    unschedulable_count: 0,
    cycle_count: 0,
    missing_dependency_count: 0,
    due_date_conflict_count: 1,
    unknown_estimate_count: 1,
    invalid_estimate_count: 0,
    parent_cycle_count: 0,
    missing_parent_count: 0,
    cancelled_prerequisite_count: 0,
    issue_count: 1,
    is_healthy: false,
  },
  issues: [
    {
      code: 'due_date_conflict',
      severity: 'warning',
      task_ids: ['selected'],
      related_task_ids: [],
      message: 'Selected task may miss its deadline',
    },
  ],
  issues_truncated: false,
};

describe('TaskGraphHealthPanel', () => {
  it('shows deterministic counts and marks incomplete critical paths as provisional', () => {
    render(<TaskGraphHealthPanel insights={response} isLoading={false} isError={false} />);

    const panel = screen.getByRole('region', { name: 'Graph execution insights' });
    expect(within(panel).getByText('1 issue')).toBeInTheDocument();
    expect(within(panel).getByText('45m+')).toBeInTheDocument();
    expect(within(panel).getByText('Selected task may miss its deadline')).toBeInTheDocument();
  });

  it('does not invent metrics while the server calculation is unavailable', () => {
    render(<TaskGraphHealthPanel isLoading={false} isError />);
    expect(screen.getByRole('status')).toHaveTextContent('temporarily unavailable');
    expect(screen.queryByText('Ready now')).not.toBeInTheDocument();
  });

  it('does not hide diagnostic warnings behind a healthy label', () => {
    render(
      <TaskGraphHealthPanel
        insights={{ ...response, summary: { ...response.summary, is_healthy: true } }}
        isLoading={false}
        isError={false}
      />,
    );

    expect(screen.getByText('1 warning')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });
});

describe('TaskGraphNodeInsightPanel', () => {
  it('resolves blocker and downstream titles and keeps navigation explicit', () => {
    const onOpenTask = vi.fn();
    const selected = node('selected', {
      title: 'Analyze results',
      scope_role: 'context',
      execution_state: 'blocked',
      is_blocked: true,
      is_on_critical_path: true,
      direct_blocker_ids: ['blocker'],
      transitive_blocker_ids: ['upstream'],
      transitive_blocker_count: 6,
      transitive_blockers_truncated: true,
      downstream_task_ids: ['review'],
      downstream_count: 8,
      downstream_truncated: true,
      remaining_path_known_minutes: 45,
      due_risk: 'insufficient_time',
    });
    const allInsights = [
      selected,
      node('blocker', { title: 'Run experiment' }),
      node('upstream', { title: 'Collect data' }),
      node('review', { title: 'Review figures' }),
    ];

    render(
      <TaskGraphNodeInsightPanel
        insight={selected}
        allInsights={allInsights}
        generatedAt={response.generated_at}
        onClose={vi.fn()}
        onOpenTask={onOpenTask}
      />,
    );

    const details = screen.getByRole('complementary', {
      name: 'Execution details for Analyze results',
    });
    expect(within(details).getByText('Run experiment')).toBeInTheDocument();
    expect(within(details).getByText('Collect data')).toBeInTheDocument();
    expect(within(details).getByText('Review figures')).toBeInTheDocument();
    expect(within(details).getByText('≥8 tasks')).toBeInTheDocument();
    expect(within(details).getByText('+5 or more')).toBeInTheDocument();
    expect(within(details).getByText('+7 or more')).toBeInTheDocument();
    expect(within(details).getByText('External prerequisite')).toBeInTheDocument();
    expect(within(details).getByText('45m+')).toBeInTheDocument();

    fireEvent.click(within(details).getByRole('button', { name: /open task/i }));
    expect(onOpenTask).toHaveBeenCalledWith('selected');
  });

  it('does not describe terminal tasks as actively clear to execute', () => {
    const completed = node('completed', {
      title: 'Finished work',
      status: 'completed',
      execution_state: 'completed',
      estimate_complete: true,
      remaining_path_minutes: 0,
    });

    render(
      <TaskGraphNodeInsightPanel
        insight={completed}
        allInsights={[completed]}
        generatedAt={response.generated_at}
        onClose={vi.fn()}
        onOpenTask={vi.fn()}
      />,
    );

    expect(screen.queryByText('No active blockers.')).not.toBeInTheDocument();
    expect(screen.queryByText('All prerequisites are complete.')).not.toBeInTheDocument();
  });

  it('labels corrupt non-positive estimates instead of rejecting diagnostic data', () => {
    const invalid = node('invalid', {
      title: 'Invalid estimate task',
      estimated_minutes: -5,
    });

    render(
      <TaskGraphNodeInsightPanel
        insight={invalid}
        allInsights={[invalid]}
        generatedAt={response.generated_at}
        onClose={vi.fn()}
        onOpenTask={vi.fn()}
      />,
    );

    expect(screen.getByText('Invalid estimate')).toBeInTheDocument();
  });

  it('does not present a nested container estimate as executable path duration', () => {
    const container = node('container', {
      title: 'Experiment phase',
      is_container: true,
      estimated_minutes: 120,
      is_on_critical_path: true,
      remaining_path_known_minutes: 30,
      estimate_complete: false,
      due_risk: 'unknown_estimate',
    });

    render(
      <TaskGraphNodeInsightPanel
        insight={container}
        allInsights={[container]}
        generatedAt={response.generated_at}
        onClose={vi.fn()}
        onOpenTask={vi.fn()}
      />,
    );

    expect(screen.getByText('Structural container')).toBeInTheDocument();
    expect(screen.getByText('Not counted (container)')).toBeInTheDocument();
    expect(screen.getByText('30m+')).toBeInTheDocument();
    expect(screen.getByText('Provisional critical path')).toBeInTheDocument();
    expect(
      screen.getByText(/stored estimate is not added to the critical path/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('2h')).not.toBeInTheDocument();
  });

  it('renders closure cap counts as lower bounds when the server truncates at 20 IDs', () => {
    const downstreamIds = Array.from({ length: 20 }, (_, index) => `downstream-${index}`);
    const capped = node('capped', {
      title: 'Wide dependency fan-out',
      downstream_task_ids: downstreamIds,
      downstream_count: 21,
      downstream_truncated: true,
      transitive_blocker_ids: downstreamIds,
      transitive_blocker_count: 21,
      transitive_blockers_truncated: true,
    });
    const related = downstreamIds.map((taskId) => node(taskId));

    render(
      <TaskGraphNodeInsightPanel
        insight={capped}
        allInsights={[capped, ...related]}
        generatedAt={response.generated_at}
        onClose={vi.fn()}
        onOpenTask={vi.fn()}
      />,
    );

    expect(screen.getByText('≥21 tasks')).toBeInTheDocument();
    expect(screen.getAllByText('+17 or more')).toHaveLength(2);
    expect(screen.queryByText('downstream-4')).not.toBeInTheDocument();
  });
});
