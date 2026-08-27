import { describe, expect, it } from 'vitest';
import type { PlanSubtask, TodoResponse } from '../../../types/api';
import {
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
  it('builds temporary hierarchy and dependency IDs without mutating the root', () => {
    const result = buildProposalTodos(root, subtasks);

    expect(result[0].id).toBe(PROPOSAL_ROOT_ID);
    expect(result[1]).toMatchObject({
      id: proposalNodeId(0),
      parent_id: PROPOSAL_ROOT_ID,
      priority: 'high',
      depends_on: [],
    });
    expect(result[3].depends_on).toEqual([proposalNodeId(1)]);
    expect(root.id).toBe('real-root');
  });

  it('ignores invalid, self, and missing dependency indices', () => {
    const result = buildProposalTodos(root, [
      { title: 'Safe task', depends_on_indices: [-1, 0, 3] },
    ]);

    expect(result[1].depends_on).toEqual([]);
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
