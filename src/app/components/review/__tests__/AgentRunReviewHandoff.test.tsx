import { fireEvent, render, screen } from '@testing-library/react';
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
        onOpenInbox={vi.fn()}
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

  it('shows the applied outcome and links to newly Ready work, the completed task, and Inbox', () => {
    const onOpenTask = vi.fn();
    const onOpenInbox = vi.fn();
    render(
      <AgentRunReviewHandoff
        taskTitle="Run experiment"
        outcome={{
          run_id: 'run-1',
          agent_task_id: 'agent-task-1',
          todo_id: 'task-run',
          todo_status: 'completed',
          graph_revision: 18,
          newly_ready_tasks: readyTasks,
          adopted: true,
        }}
        onOpenTask={onOpenTask}
        onOpenInbox={onOpenInbox}
      />,
    );

    expect(screen.getByLabelText('Agent approval outcome')).toHaveTextContent('Task completed');
    expect(screen.getByText('2 downstream tasks are now Ready.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Analyze experiment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open completed task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Inbox' }));

    expect(onOpenTask).toHaveBeenNthCalledWith(1, 'task-analysis');
    expect(onOpenTask).toHaveBeenNthCalledWith(2, 'task-run');
    expect(onOpenInbox).toHaveBeenCalledOnce();
  });
});
