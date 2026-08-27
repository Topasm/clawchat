import { describe, expect, it } from 'vitest';
import type { InboxTriagePreviewResponse } from '../../types/schemas';
import { buildInboxTriagePlacementGroups } from '../inboxTriage';

const preview: InboxTriagePreviewResponse = {
  base_graph_revision: 12,
  model_provider: 'test',
  unassigned_task_ids: [],
  proposed_workstreams: [
    {
      key: 'submission',
      project_id: 'project-paper',
      parent_id: null,
      title: 'Submission',
      description: 'Submission preparation',
      confidence: 0.9,
      reason: 'These tasks form a new branch.',
    },
  ],
  suggestions: [
    {
      task_id: 'task-format',
      project_id: 'project-paper',
      parent_id: null,
      proposed_parent_key: 'submission',
      confidence: 0.9,
      reason: 'Submission task',
    },
    {
      task_id: 'task-deadline',
      project_id: 'project-paper',
      parent_id: null,
      proposed_parent_key: 'submission',
      confidence: 0.85,
      reason: 'Submission task',
    },
    {
      task_id: 'task-figure',
      project_id: 'project-paper',
      parent_id: 'parent-figures',
      proposed_parent_key: null,
      confidence: 0.95,
      reason: 'Existing figures branch',
    },
  ],
};

describe('buildInboxTriagePlacementGroups', () => {
  it('groups selected Tasks under one proposed Workstream creation', () => {
    expect(buildInboxTriagePlacementGroups(preview, ['task-format', 'task-deadline'])).toEqual([
      {
        todo_ids: ['task-format', 'task-deadline'],
        project_id: 'project-paper',
        parent_id: null,
        inbox_state: 'none',
        create_parent: {
          title: 'Submission',
          description: 'Submission preparation',
          parent_id: null,
        },
      },
    ]);
  });

  it('keeps existing and proposed destinations separate', () => {
    const groups = buildInboxTriagePlacementGroups(preview, ['task-format', 'task-figure']);

    expect(groups).toHaveLength(2);
    expect(groups[0].create_parent?.title).toBe('Submission');
    expect(groups[1]).toMatchObject({
      todo_ids: ['task-figure'],
      project_id: 'project-paper',
      parent_id: 'parent-figures',
    });
  });
});
