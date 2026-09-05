import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AgentRunReviewHandoff from '../AgentRunReviewHandoff';

const readyTasks = [
  { id: 'task-analysis', title: 'Analyze experiment' },
  { id: 'task-report', title: 'Draft report' },
];

describe('AgentRunReviewHandoff', () => {
  it('previews task completion and the downstream tasks that approval will unlock', () => {
    render(
      <AgentRunReviewHandoff
        taskTitle="Run experiment"
        impact={{ todo_id: 'task-run', graph_revision: 17, newly_ready_tasks: readyTasks }}
        onOpenTask={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Agent approval impact')).toHaveTextContent(
      'Completes “Run experiment”',
    );
    expect(screen.getByText('2 downstream tasks will become Ready.')).toBeInTheDocument();
    expect(screen.getByText('Analyze experiment')).toBeInTheDocument();
    expect(screen.getByText('Draft report')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts one next Ready task only after the user clicks Run next', async () => {
    const onOpenTask = vi.fn();
    const onRunNext = vi.fn().mockResolvedValue({ run_id: 'run-next' });
    const onChooseAnother = vi.fn();
    const onStop = vi.fn();
    const onOpenRun = vi.fn();
    render(
      <AgentRunReviewHandoff
        taskTitle="Run experiment"
        outcome={{
          run_id: 'run-1',
          agent_task_id: 'agent-task-1',
          todo_id: 'task-run',
          todo_status: 'completed',
          graph_revision: 18,
          newly_ready_tasks: [readyTasks[0]],
          adopted: true,
        }}
        onOpenTask={onOpenTask}
        onRunNext={onRunNext}
        canRunNext
        onChooseAnother={onChooseAnother}
        onStop={onStop}
        onOpenRun={onOpenRun}
      />,
    );

    expect(screen.getByLabelText('Agent approval outcome')).toHaveTextContent('Task completed');
    expect(onRunNext).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open Analyze experiment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run next' }));

    expect(onOpenTask).toHaveBeenCalledWith('task-analysis');
    expect(onChooseAnother).toHaveBeenCalledOnce();
    expect(onRunNext).toHaveBeenCalledWith(readyTasks[0]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open started run' })).toBeVisible(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open started run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onOpenRun).toHaveBeenCalledWith('run-next');
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('requires a choice when approval unlocks multiple Ready tasks', () => {
    const run = vi.fn();
    const choose = vi.fn();
    render(
      <AgentRunReviewHandoff
        outcome={{
          run_id: 'run',
          agent_task_id: 'agent',
          todo_id: 'task',
          todo_status: 'completed',
          graph_revision: 18,
          newly_ready_tasks: readyTasks,
          adopted: true,
        }}
        onOpenTask={vi.fn()}
        onRunNext={run}
        canRunNext
        onChooseAnother={choose}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Run next' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    expect(choose).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });
});
