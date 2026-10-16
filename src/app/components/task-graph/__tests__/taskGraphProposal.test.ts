import { describe, expect, it } from 'vitest';
import type { PlanSubtask } from '../../../types/api';
import {
  buildProposalEdges,
  proposalIndexFromNodeId,
  proposalNodeId,
  toggleProposalSelection,
} from '../taskGraphProposal';

const subtasks: PlanSubtask[] = [
  { title: 'Research', depends_on_indices: [] },
  { title: 'Build', depends_on_indices: [0] },
  { title: 'Review', depends_on_indices: [1] },
  { title: 'Announce', depends_on_indices: [2] },
];

describe('task graph proposal adapter', () => {
  it('draws prerequisite arrows and ignores invalid references', () => {
    const edges = buildProposalEdges([
      { title: 'Safe task', depends_on_indices: [-1, 0, 3] },
      { title: 'Dependent task', depends_on_indices: [0, 0] },
    ]);

    expect(edges).toEqual([{ before: proposalNodeId(0), after: proposalNodeId(1) }]);
  });

  it('maps proposal node IDs back to subtask indices', () => {
    expect(proposalIndexFromNodeId(proposalNodeId(12))).toBe(12);
    expect(proposalIndexFromNodeId('proposal:root')).toBeNull();
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
