import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskExecutionTelemetryResponse, TodoResponse } from '../../../types/api';
import TaskListView from '../TaskListView';

vi.mock('../../shared/StorageLocationBadge', () => ({ default: () => null }));

function todo(overrides: Partial<TodoResponse>): TodoResponse {
  return {
    id: 'todo-1',
    title: 'Draft the report',
    status: 'pending',
    priority: 'medium',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  } as TodoResponse;
}

describe('TaskListView', () => {
  it('names the prerequisite a task waits on under its title', () => {
    render(
      <TaskListView
        todos={[
          todo({
            id: 'todo-report',
            open_prerequisites: [{ id: 'todo-profile', title: 'Profile the kernel' }],
          }),
          todo({
            id: 'todo-submit',
            title: 'Submit the assignment',
            open_prerequisites: [
              { id: 'todo-profile', title: 'Profile the kernel' },
              { id: 'todo-report', title: 'Draft the report' },
            ],
          }),
          todo({ id: 'todo-profile', title: 'Profile the kernel', open_prerequisites: [] }),
        ]}
        onOpenTask={vi.fn()}
        onToggleTask={vi.fn()}
      />,
    );
    expect(screen.getByText('Waiting on · Profile the kernel')).toBeInTheDocument();
    expect(screen.getByText('Waiting on 2 tasks')).toBeInTheDocument();
    // The blocked rows keep their step but say why nothing is moving.
    expect(screen.getAllByText('Blocked')).toHaveLength(2);
    expect(screen.queryByText(/Waiting on · Draft/)).not.toBeInTheDocument();
  });

  it('drops the line once the task is done, whatever its edges say', () => {
    render(
      <TaskListView
        todos={[
          todo({
            status: 'completed',
            open_prerequisites: [{ id: 'todo-profile', title: 'Profile the kernel' }],
          }),
        ]}
        onOpenTask={vi.fn()}
        onToggleTask={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Waiting on/)).not.toBeInTheDocument();
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument();
  });

  it('keeps the row of the task open beside the list raised', () => {
    const { container } = render(
      <TaskListView
        todos={[todo({ id: 'todo-open' }), todo({ id: 'todo-other', title: 'Other' })]}
        onOpenTask={vi.fn()}
        onToggleTask={vi.fn()}
        selectedTaskId="todo-open"
      />,
    );
    const rows = container.querySelectorAll('.cc-task-row');
    expect(rows[0]).toHaveClass('cc-task-row--selected');
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    expect(rows[1]).not.toHaveClass('cc-task-row--selected');
  });
});

describe('TaskListView blocked rows', () => {
  it('opens the prerequisite from its name without opening the row', () => {
    const onOpenTask = vi.fn();
    render(
      <TaskListView
        todos={[
          todo({
            id: 'todo-report',
            open_prerequisites: [{ id: 'todo-profile', title: 'Profile the kernel' }],
          }),
        ]}
        onOpenTask={onOpenTask}
        onToggleTask={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go to Profile the kernel' }));
    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(onOpenTask).toHaveBeenCalledWith('todo-profile');
  });

  it('says the prerequisite is in progress when an agent is on it, and is amber only when late', () => {
    const telemetry = new Map<string, TaskExecutionTelemetryResponse>([
      ['todo-profile', { task_id: 'todo-profile', latest_run_status: 'running' } as never],
    ]);
    render(
      <TaskListView
        todos={[
          todo({
            id: 'todo-report',
            due_date: '2020-01-01T00:00:00Z',
            open_prerequisites: [{ id: 'todo-profile', title: 'Profile the kernel' }],
          }),
          todo({
            id: 'todo-slides',
            title: 'Draft the slides',
            due_date: '2099-01-01T00:00:00Z',
            open_prerequisites: [
              { id: 'todo-other', title: 'A prerequisite with a very long name' },
            ],
          }),
        ]}
        onOpenTask={vi.fn()}
        onToggleTask={vi.fn()}
        telemetryByTaskId={telemetry}
      />,
    );
    const late = screen.getByText('Prerequisite running · Profile the kernel').closest('small');
    expect(late).toHaveClass('cc-waiting-on--late');
    // A long prerequisite name is cut so the line stays one line.
    const ahead = screen.getByText('Waiting on · A prerequisite with…').closest('small');
    expect(ahead).not.toHaveClass('cc-waiting-on--late');
  });

  it('says where a task stands only once an agent is involved', () => {
    const telemetry = new Map<string, TaskExecutionTelemetryResponse>([
      ['todo-run', { task_id: 'todo-run', latest_run_status: 'running' } as never],
    ]);
    render(
      <TaskListView
        todos={[todo({ id: 'todo-own' }), todo({ id: 'todo-run', title: 'Profile' })]}
        onOpenTask={vi.fn()}
        onToggleTask={vi.fn()}
        telemetryByTaskId={telemetry}
      />,
    );
    expect(screen.queryByText('Captured')).not.toBeInTheDocument();
    expect(screen.getByText('Run')).toBeInTheDocument();
  });
});
