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
  it('renders task execution and artifact telemetry as compact overlays', () => {
    render(
      <InboxTriageTree
        projects={[project]}
        todos={[task]}
        selectedTaskId={null}
        batchTaskIds={[]}
        telemetryByTaskId={
          new Map([
            [
              task.id,
              {
                task_id: task.id,
                latest_run_id: 'run-1',
                latest_run_status: 'running',
                latest_run_progress: 42,
                latest_run_provider: 'openclaw',
                latest_run_progress_message: 'Building report',
                latest_run_updated_at: '2026-08-27T00:00:00Z',
                human_wait_seconds: 0,
                question_count: 0,
                average_resume_seconds: null,
                pending_review_count: 0,
                artifact_count: 2,
                latest_artifact_id: 'artifact-2',
                latest_artifact_title: 'Report',
                latest_artifact_type: 'report',
                latest_artifact_updated_at: '2026-08-27T00:00:00Z',
              },
            ],
          ])
        }
        disabled={false}
        onSelectTask={vi.fn()}
        onPlace={vi.fn()}
        onPlaceBatch={vi.fn()}
        onPreviewDependency={vi.fn()}
      />,
    );

    expect(screen.getByText('Agent 42%')).toBeInTheDocument();
    expect(screen.getByText('2 artifacts')).toBeInTheDocument();
  });

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

  // A task with no project and no Inbox state used to appear nowhere on this
  // page; the tree now shows it so it can be selected and dragged home.
  it('lists tasks that belong to no project, but not captures or finished work', () => {
    const loose: TodoResponse = {
      ...task,
      id: 'loose-1',
      title: 'Prepare the meeting',
      project_id: undefined,
      parent_id: undefined,
    };
    const captured: TodoResponse = {
      ...loose,
      id: 'inbox-9',
      title: 'Captured',
      inbox_state: 'captured',
    };
    const done: TodoResponse = { ...loose, id: 'done-9', title: 'Finished', status: 'completed' };
    const onSelectTask = vi.fn();
    render(
      <InboxTriageTree
        projects={[project]}
        todos={[task, loose, captured, done]}
        selectedTaskId={null}
        batchTaskIds={[]}
        disabled={false}
        onSelectTask={onSelectTask}
        onPlace={vi.fn()}
        onPlaceBatch={vi.fn()}
        onPreviewDependency={vi.fn()}
      />,
    );

    const group = screen.getByLabelText('No project');
    expect(group).toHaveTextContent('Prepare the meeting');
    expect(group).not.toHaveTextContent('Captured');
    expect(group).not.toHaveTextContent('Finished');
    fireEvent.click(screen.getByRole('button', { name: /Prepare the meeting/ }));
    expect(onSelectTask).toHaveBeenCalledWith('loose-1');
  });

  it('opens the project from its heading', () => {
    const onOpenProject = vi.fn();
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
        onOpenProject={onOpenProject}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open project Paper' }));
    expect(onOpenProject).toHaveBeenCalledWith('project-1');
  });

  it('starts a new task inside a project from the tree', () => {
    const onAddTask = vi.fn();
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
        onAddTask={onAddTask}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add a task to Paper' }));
    expect(onAddTask).toHaveBeenCalledWith('project-1', 'root-1');
  });
});
