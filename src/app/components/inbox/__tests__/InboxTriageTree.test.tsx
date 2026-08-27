import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectResponse, TodoResponse } from '../../../types/api';
import InboxTriageTree from '../InboxTriageTree';

const project: ProjectResponse = {
  id: 'project-1',
  title: 'Paper',
  status: 'active',
  graph_revision: 3,
  root_task_id: 'root-1',
  execution_workspace_isolation: 'local',
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T00:00:00Z',
  task_count: 1,
  completed_task_count: 0,
};

const task: TodoResponse = {
  id: 'workstream-1',
  title: 'Figures',
  project_id: project.id,
  parent_id: project.root_task_id,
  status: 'pending',
  sort_order: 0,
  inbox_state: 'none',
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T00:00:00Z',
};

describe('InboxTriageTree', () => {
  it('places the selected Inbox task at the project root', () => {
    const onPlace = vi.fn();
    render(
      <InboxTriageTree
        projects={[project]}
        todos={[task]}
        selectedTaskId="inbox-1"
        batchTaskIds={[]}
        disabled={false}
        onSelectTask={vi.fn()}
        onPlace={onPlace}
        onPlaceBatch={vi.fn()}
        onPreviewDependency={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Place selected task in Paper' }));
    expect(onPlace).toHaveBeenCalledWith('inbox-1', project.id, null);
  });

  it('keeps hierarchy placement distinct from project placement', () => {
    const onPlace = vi.fn();
    render(
      <InboxTriageTree
        projects={[project]}
        todos={[task]}
        selectedTaskId="inbox-1"
        batchTaskIds={[]}
        disabled={false}
        onSelectTask={vi.fn()}
        onPlace={onPlace}
        onPlaceBatch={vi.fn()}
        onPreviewDependency={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Place selected task under Figures' }));
    expect(onPlace).toHaveBeenCalledWith('inbox-1', project.id, task.id);
  });

  it('provides a touch-friendly sibling insertion action', () => {
    const onPlace = vi.fn();
    render(
      <InboxTriageTree
        projects={[project]}
        todos={[task]}
        selectedTaskId="inbox-1"
        batchTaskIds={[]}
        disabled={false}
        onSelectTask={vi.fn()}
        onPlace={onPlace}
        onPlaceBatch={vi.fn()}
        onPreviewDependency={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Place selected task before Figures' }));
    expect(onPlace).toHaveBeenCalledWith('inbox-1', project.id, project.root_task_id, task.id);
  });

  it('renders compatibility-root children as top-level project tasks', () => {
    render(
      <InboxTriageTree
        projects={[project]}
        todos={[task]}
        selectedTaskId={null}
        batchTaskIds={[]}
        disabled={false}
        onSelectTask={vi.fn()}
        onPlace={vi.fn()}
        onPlaceBatch={vi.fn()}
        onPreviewDependency={vi.fn()}
      />,
    );

    expect(screen.getByText('Figures')).toBeInTheDocument();
  });

  it('accepts a dragged Inbox task on the project target', () => {
    const onPlace = vi.fn();
    render(
      <InboxTriageTree
        projects={[project]}
        todos={[task]}
        selectedTaskId={null}
        batchTaskIds={[]}
        disabled={false}
        onSelectTask={vi.fn()}
        onPlace={onPlace}
        onPlaceBatch={vi.fn()}
        onPreviewDependency={vi.fn()}
      />,
    );

    const projectTarget = screen.getByText('Paper').parentElement;
    expect(projectTarget).not.toBeNull();
    fireEvent.drop(projectTarget!, {
      dataTransfer: {
        types: ['application/x-clawchat-task-id'],
        getData: (type: string) => (type === 'application/x-clawchat-task-id' ? 'inbox-1' : ''),
      },
    });
    expect(onPlace).toHaveBeenCalledWith('inbox-1', project.id, null);
  });

  it('uses the selected task as the dependent and the connector node as prerequisite', () => {
    const onPreviewDependency = vi.fn();
    render(
      <InboxTriageTree
        projects={[project]}
        todos={[task]}
        selectedTaskId="inbox-1"
        batchTaskIds={[]}
        disabled={false}
        onSelectTask={vi.fn()}
        onPlace={vi.fn()}
        onPlaceBatch={vi.fn()}
        onPreviewDependency={onPreviewDependency}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Dependency connector for Figures. Drag to a prerequisite or drop a dependent here.',
      }),
    );

    expect(onPreviewDependency).toHaveBeenCalledWith('inbox-1', task.id);
  });

  it('does not treat a dependency connector drop as hierarchy placement', () => {
    const onPlace = vi.fn();
    const onPreviewDependency = vi.fn();
    render(
      <InboxTriageTree
        projects={[project]}
        todos={[task]}
        selectedTaskId={null}
        batchTaskIds={[]}
        disabled={false}
        onSelectTask={vi.fn()}
        onPlace={onPlace}
        onPlaceBatch={vi.fn()}
        onPreviewDependency={onPreviewDependency}
      />,
    );

    const connector = screen.getByRole('button', {
      name: 'Dependency connector for Figures. Drag to a prerequisite or drop a dependent here.',
    });
    fireEvent.drop(connector, {
      dataTransfer: {
        types: ['application/x-clawchat-task-dependency'],
        getData: (type: string) =>
          type === 'application/x-clawchat-task-dependency' ? 'dependent-1' : '',
      },
    });

    expect(onPreviewDependency).toHaveBeenCalledWith('dependent-1', task.id);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('places a dragged batch through one atomic callback', () => {
    const onPlace = vi.fn();
    const onPlaceBatch = vi.fn();
    render(
      <InboxTriageTree
        projects={[project]}
        todos={[task]}
        selectedTaskId="inbox-1"
        batchTaskIds={['inbox-1', 'inbox-2']}
        disabled={false}
        onSelectTask={vi.fn()}
        onPlace={onPlace}
        onPlaceBatch={onPlaceBatch}
        onPreviewDependency={vi.fn()}
      />,
    );

    const projectTarget = screen.getByText('Paper').parentElement;
    expect(projectTarget).not.toBeNull();
    fireEvent.drop(projectTarget!, {
      dataTransfer: {
        types: ['application/x-clawchat-task-batch'],
        getData: (type: string) =>
          type === 'application/x-clawchat-task-batch'
            ? JSON.stringify(['inbox-1', 'inbox-2'])
            : '',
      },
    });

    expect(onPlaceBatch).toHaveBeenCalledWith(['inbox-1', 'inbox-2'], project.id, null);
    expect(onPlace).not.toHaveBeenCalled();
  });
});
