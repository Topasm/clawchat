import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanProposalResponse } from '../../../types/api';
import PlanReviewDiff from '../PlanReviewDiff';

const proposal: PlanProposalResponse = {
  proposal_id: 'proposal-1',
  task_id: 'proposal-1',
  agent_task_id: null,
  todo_id: 'task-1',
  base_graph_revision: 7,
  status: 'draft',
  validation: { errors: [], warnings: [] },
  diff: {
    add_task_count: 3,
    add_relationship_count: 2,
    root_update_fields: ['due_date'],
  },
  summary: 'Sequential delivery plan',
  suggested_root_due_date: null,
  suggested_assignee: null,
  suggested_skills: null,
  suggested_project_title: null,
  subtasks: [
    { title: 'Research', depends_on_indices: [] },
    { title: 'Build', depends_on_indices: [0] },
    { title: 'Review', depends_on_indices: [1] },
  ],
  subtask_count: 3,
  suggested_due_summary: null,
  suggested_assignee_label: null,
  suggested_skills_labels: null,
  suggested_project_label: null,
  created_at: '2026-08-27T00:00:00Z',
};

function renderReview(
  plan: PlanProposalResponse = proposal,
  overrides: Partial<React.ComponentProps<typeof PlanReviewDiff>> = {},
) {
  const props: React.ComponentProps<typeof PlanReviewDiff> = {
    plan,
    onApply: vi.fn(),
    onDismiss: vi.fn(),
    onRegenerate: vi.fn(),
    ...overrides,
  };
  return { ...render(<PlanReviewDiff {...props} />), props };
}

describe('PlanReviewDiff', () => {
  it('keeps selection dependency-closed before applying', () => {
    const { props } = renderReview();
    const checkboxes = screen.getAllByRole('checkbox');

    fireEvent.click(checkboxes[0]);
    checkboxes.forEach((checkbox) => expect(checkbox).not.toBeChecked());
    expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled();

    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply (2/3)' }));

    expect(props.onApply).toHaveBeenCalledWith([0, 1]);
  });

  it('preserves user selection when the same proposal is parsed into a new array identity', () => {
    const onApply = vi.fn();
    const { rerender } = render(
      <PlanReviewDiff
        plan={proposal}
        onApply={onApply}
        onDismiss={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole('checkbox')[2]);
    expect(screen.getByRole('button', { name: 'Apply (2/3)' })).toBeEnabled();

    const reparsed = {
      ...proposal,
      subtasks: proposal.subtasks.map((subtask) => ({ ...subtask })),
    };
    rerender(
      <PlanReviewDiff
        plan={reparsed}
        onApply={onApply}
        onDismiss={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply (2/3)' }));
    expect(onApply).toHaveBeenCalledWith([0, 1]);
  });

  it('fails closed for a stale status even without a 409 mutation error', () => {
    const onRegenerate = vi.fn();
    renderReview({ ...proposal, status: 'stale' }, { onRegenerate });

    expect(screen.getByRole('alert')).toHaveTextContent('task graph changed');
    expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it('prioritizes the legacy revision warning over a duplicate stale warning', () => {
    renderReview({ ...proposal, base_graph_revision: null, status: 'stale' });

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('older proposal');
  });

  it('shows authoritative diff and disables a proposal with validation errors', () => {
    renderReview({
      ...proposal,
      validation: {
        errors: [{ code: 'CYCLE', message: 'The proposal contains a cycle' }],
        warnings: [],
      },
    });

    expect(screen.getByLabelText('Authoritative proposal diff')).toHaveTextContent(
      '3 tasks to add',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The proposal contains a cycle');
    expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled();
  });
});
