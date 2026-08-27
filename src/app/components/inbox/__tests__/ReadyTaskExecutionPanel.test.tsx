import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ExecutionProviderStatus,
  Skill,
  TaskGraphInsightNode,
  TodoResponse,
} from '../../../types/api';
import ReadyTaskExecutionPanel from '../ReadyTaskExecutionPanel';

const task: TodoResponse = {
  id: 'task-ready',
  title: 'Analyze results',
  project_id: 'project-1',
  parent_id: 'root-1',
  status: 'pending',
  enabled_skills: ['research'],
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
};

const insight: TaskGraphInsightNode = {
  task_id: task.id,
  title: task.title,
  status: 'pending',
  parent_id: task.parent_id ?? null,
  scope_role: 'descendant',
  execution_state: 'ready',
  estimated_minutes: 30,
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
  is_ready: true,
  is_blocked: false,
  is_unschedulable: false,
  is_on_critical_path: true,
  remaining_path_minutes: 30,
  remaining_path_known_minutes: 30,
  estimate_complete: true,
  due_risk: 'none',
  due_slack_minutes: null,
};

const skills: Skill[] = [
  { id: 'plan', name: 'Plan', description: 'Plan work', tags: [] },
  { id: 'research', name: 'Research', description: 'Research work', tags: [] },
];

const providers: ExecutionProviderStatus[] = [
  {
    id: 'builtin',
    label: 'Built-in AI and skills',
    enabled: true,
    available: true,
    connected: true,
    host: 'ClawChat',
    providers: [],
  },
];

describe('ReadyTaskExecutionPanel', () => {
  it('requires a review step before starting exactly one Ready task run', async () => {
    const onStart = vi.fn().mockResolvedValue({ run_id: 'run-1' });
    const onOpenRun = vi.fn();
    render(
      <ReadyTaskExecutionPanel
        task={task}
        insight={insight}
        skills={skills}
        providers={providers}
        isStarting={false}
        onStart={onStart}
        onOpenRun={onOpenRun}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Start agent run' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review agent run' }));
    expect(screen.getByText('Start one approved run?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start agent run' }));

    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith({
        skillId: 'research',
        executionProvider: 'builtin',
        model: null,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open started run' }));
    expect(onOpenRun).toHaveBeenCalledWith('run-1');
  });

  it('explains a blocked task without exposing execution controls', () => {
    render(
      <ReadyTaskExecutionPanel
        task={task}
        insight={{ ...insight, is_ready: false, is_blocked: true, execution_state: 'blocked' }}
        skills={skills}
        providers={providers}
        isStarting={false}
        onStart={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );

    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Unavailable while blocked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review agent run' })).not.toBeInTheDocument();
  });

  it('hides the launcher while the task already has an active run', () => {
    const { container } = render(
      <ReadyTaskExecutionPanel
        task={task}
        insight={insight}
        telemetry={{
          task_id: task.id,
          latest_run_id: 'run-active',
          latest_run_status: 'running',
          latest_run_progress: 20,
          latest_run_provider: 'builtin',
          latest_run_progress_message: null,
          latest_run_updated_at: '2026-08-28T00:00:00Z',
          pending_review_count: 0,
          artifact_count: 0,
          latest_artifact_id: null,
          latest_artifact_title: null,
          latest_artifact_type: null,
          latest_artifact_updated_at: null,
        }}
        skills={skills}
        providers={providers}
        isStarting={false}
        onStart={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
