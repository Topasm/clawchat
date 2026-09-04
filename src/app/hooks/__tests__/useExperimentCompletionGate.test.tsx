import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useExperimentCompletionGate, { isExperimentTask } from '../useExperimentCompletionGate';
import type { TodoResponse } from '../../types/api';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../services/apiClient', () => ({ default: { post: mocks.post } }));

function todo(tags: string[]): TodoResponse {
  return {
    id: 'todo-1',
    title: 'E65a Run',
    status: 'pending',
    tags,
    created_at: '2026-09-04T00:00:00Z',
    updated_at: '2026-09-04T00:00:00Z',
  };
}

function Harness({ task, onProceed }: { task: TodoResponse; onProceed: () => void }) {
  const { requestStatusChange, confirmationDialog } = useExperimentCompletionGate();
  return (
    <>
      <button onClick={() => requestStatusChange(task, 'completed', onProceed)}>Complete</button>
      {confirmationDialog}
    </>
  );
}

describe('experiment completion gate', () => {
  beforeEach(() => mocks.post.mockReset().mockResolvedValue({}));

  it('recognizes exp tags with or without an Obsidian hash prefix', () => {
    expect(isExperimentTask(todo(['exp/E65']))).toBe(true);
    expect(isExperimentTask(todo(['#exp/E65']))).toBe(true);
    expect(isExperimentTask(todo(['branch/P0-R']))).toBe(false);
  });

  it('asks before completing experiment tasks but not ordinary tasks', () => {
    const experimentProceed = vi.fn();
    const ordinaryProceed = vi.fn();
    const { rerender } = render(<Harness task={todo(['exp/E65'])} onProceed={experimentProceed} />);

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect(screen.getByText('Did you record the verdict in the original document?')).toBeVisible();
    expect(experimentProceed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Recorded' }));
    expect(experimentProceed).toHaveBeenCalledOnce();

    rerender(<Harness task={todo(['repo/srp'])} onProceed={ordinaryProceed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect(ordinaryProceed).toHaveBeenCalledOnce();
    expect(
      screen.queryByText('Did you record the verdict in the original document?'),
    ).not.toBeInTheDocument();
  });

  it('completes and records a comment when Later is selected', async () => {
    const onProceed = vi.fn();
    render(<Harness task={todo(['exp/E65a'])} onProceed={onProceed} />);

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));

    expect(onProceed).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/task-comments', {
        todo_id: 'todo-1',
        content: '판정 미기록',
      }),
    );
  });
});
