import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaskListView from '../TaskListView';
import type { TodoResponse } from '../../../types/api';

vi.mock('../../shared/StorageLocationBadge', () => ({ default: () => null }));

function todo(overrides: Partial<TodoResponse>): TodoResponse {
  return {
    id: 'task',
    title: 'Task',
    status: 'pending',
    priority: 'medium',
    created_at: '2026-10-16T00:00:00Z',
    updated_at: '2026-10-16T00:00:00Z',
    ...overrides,
  } as TodoResponse;
}

describe('TaskListView', () => {
  it('says which prerequisite an open task waits on', () => {
    render(
      <TaskListView
        todos={[
          todo({
            id: 'submit',
            title: 'Submit',
            open_prerequisites: [{ id: 'kernel', title: 'Write the kernel' }],
          }),
        ]}
        onOpenTask={() => {}}
        onToggleTask={() => {}}
      />,
    );
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Waiting on Write the kernel')).toBeInTheDocument();
  });

  it('names the first prerequisite and counts the rest', () => {
    render(
      <TaskListView
        todos={[
          todo({
            id: 'submit',
            title: 'Submit',
            open_prerequisites: [
              { id: 'kernel', title: 'Write the kernel' },
              { id: 'profile', title: 'Profile' },
            ],
          }),
        ]}
        onOpenTask={() => {}}
        onToggleTask={() => {}}
      />,
    );
    const line = screen.getByText('Waiting on Write the kernel +1');
    expect(line).toHaveAttribute('title', 'Write the kernel, Profile');
  });

  it('drops the line once the task is done, whatever its edges say', () => {
    render(
      <TaskListView
        todos={[
          todo({
            id: 'submit',
            title: 'Submit',
            status: 'completed',
            open_prerequisites: [{ id: 'kernel', title: 'Write the kernel' }],
          }),
        ]}
        onOpenTask={() => {}}
        onToggleTask={() => {}}
      />,
    );
    expect(screen.queryByText(/Waiting on/)).not.toBeInTheDocument();
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument();
  });
});
