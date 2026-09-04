import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InboxTriagePreviewResponse, ProjectResponse, TodoResponse } from '../../../types/api';
import InboxTriagePreviewPanel from '../InboxTriagePreviewPanel';

const projects: ProjectResponse[] = [
  {
    id: 'project-1',
    title: 'ClawChat improvements',
    status: 'active',
    root_task_id: 'todo-root',
    graph_revision: 5,
    execution_workspace_isolation: 'local',
    created_at: '2026-09-04T00:00:00Z',
    updated_at: '2026-09-04T00:00:00Z',
    task_count: 1,
    completed_task_count: 0,
  },
  {
    id: 'project-2',
    title: 'Other project',
    status: 'active',
    root_task_id: 'todo-other-root',
    graph_revision: 2,
    execution_workspace_isolation: 'local',
    created_at: '2026-09-04T00:00:00Z',
    updated_at: '2026-09-04T00:00:00Z',
    task_count: 1,
    completed_task_count: 0,
  },
];

const todos = new Map<string, TodoResponse>([
  [
    'todo-1',
    {
      id: 'todo-1',
      title: 'Add project agent',
      status: 'pending',
      created_at: '2026-09-04T00:00:00Z',
      updated_at: '2026-09-04T00:00:00Z',
    },
  ],
  [
    'todo-2',
    {
      id: 'todo-2',
      title: 'Unrelated work',
      status: 'pending',
      created_at: '2026-09-04T00:00:00Z',
      updated_at: '2026-09-04T00:00:00Z',
    },
  ],
]);

function preview(secondProjectId = 'project-1'): InboxTriagePreviewResponse {
  return {
    base_graph_revision: 5,
    suggestions: [
      {
        task_id: 'todo-1',
        project_id: 'project-1',
        parent_id: 'todo-root',
        confidence: 0.9,
        reason: 'Matches the project goal',
      },
      {
        task_id: 'todo-2',
        project_id: secondProjectId,
        parent_id: secondProjectId === 'project-1' ? 'todo-root' : 'todo-other-root',
        confidence: 0.8,
        reason: 'Related work',
      },
    ],
    proposed_workstreams: [],
    unassigned_task_ids: [],
    model_provider: null,
  };
}

function renderPanel(data: InboxTriagePreviewResponse, onApplyAndOpen = vi.fn()) {
  render(
    <InboxTriagePreviewPanel
      preview={data}
      projects={projects}
      todoById={todos}
      selectedTaskIds={['todo-1', 'todo-2']}
      isApplying={false}
      onToggleSuggestion={vi.fn()}
      onDismiss={vi.fn()}
      onApply={vi.fn()}
      onApplyAndOpen={onApplyAndOpen}
    />,
  );
  return onApplyAndOpen;
}

describe('InboxTriagePreviewPanel', () => {
  it('offers apply-and-open when all selected suggestions share a project', () => {
    const onApplyAndOpen = renderPanel(preview());

    fireEvent.click(screen.getByRole('button', { name: 'Apply & Open Project' }));
    expect(onApplyAndOpen).toHaveBeenCalledOnce();
  });

  it('does not choose a project when the selection spans projects', () => {
    renderPanel(preview('project-2'));

    expect(screen.queryByRole('button', { name: 'Apply & Open Project' })).not.toBeInTheDocument();
  });
});
