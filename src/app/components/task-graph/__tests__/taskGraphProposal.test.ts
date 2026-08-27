import { describe, expect, it } from 'vitest';
import type { PlanSubtask, TodoResponse } from '../../../types/api';
import {
  buildProposalRelationships,
  buildProposalTodos,
  PROPOSAL_ROOT_ID,
  proposalIndexFromNodeId,
  proposalNodeId,
  toggleProposalSelection,
} from '../taskGraphProposal';

const root: TodoResponse = {
  id: 'real-root',
  title: 'Ship MVP',
  status: 'pending',
  priority: 'high',
  tags: ['product'],
  created_at: '2026-08-26T00:00:00Z',
  updated_at: '2026-08-26T00:00:00Z',
};

const subtasks: PlanSubtask[] = [
  { title: 'Research', priority: 'high', depends_on_indices: [] },
  { title: 'Build', depends_on_indices: [0] },
  { title: 'Review', depends_on_indices: [1] },
  { title: 'Announce', depends_on_indices: [2] },
];

describe('task graph proposal adapter', () => {
  it('builds temporary hierarchy without mutating the root', () => {
    const todos = buildProposalTodos(root, subtasks);

    expect(todos[0].id).toBe(PROPOSAL_ROOT_ID);
    expect(todos[1]).toMatchObject({
      id: proposalNodeId(0),
      parent_id: PROPOSAL_ROOT_ID,
      priority: 'high',
    });
    expect(root.id).toBe('real-root');
  });

  it('builds normalized preview relationships and ignores invalid references', () => {
    const relationships = buildProposalRelationships([
      { title: 'Safe task', depends_on_indices: [-1, 0, 3] },
      { title: 'Dependent task', depends_on_indices: [0, 0] },
    ]);

    expect(relationships).toEqual([
      {
        id: 'proposal:relationship:1:0',
        source_task_id: proposalNodeId(1),
        target_task_id: proposalNodeId(0),
        type: 'depends_on',
      },
    ]);
  });

  it('maps proposal node IDs back to subtask indices', () => {
    expect(proposalIndexFromNodeId(proposalNodeId(12))).toBe(12);
    expect(proposalIndexFromNodeId(PROPOSAL_ROOT_ID)).toBeNull();
    expect(proposalIndexFromNodeId('proposal:subtask:not-a-number')).toBeNull();
  });
});

describe('proposal selection closure', () => {
  it('removes every transitive dependent when a prerequisite is excluded', () => {
    const result = toggleProposalSelection(subtasks, new Set([0, 1, 2, 3]), 1);

    expect([...result]).toEqual([0]);
  });

  it('restores every prerequisite when a dependent task is included', () => {
    const result = toggleProposalSelection(subtasks, new Set<number>(), 3);

    expect(result).toEqual(new Set([3, 2, 1, 0]));
  });

  it('terminates safely when AI returns cyclic dependencies', () => {
    const cyclic: PlanSubtask[] = [
      { title: 'A', depends_on_indices: [1] },
      { title: 'B', depends_on_indices: [0] },
    ];

    expect(toggleProposalSelection(cyclic, new Set<number>(), 0)).toEqual(new Set([0, 1]));
    expect(toggleProposalSelection(cyclic, new Set([0, 1]), 0)).toEqual(new Set());
  });
});
