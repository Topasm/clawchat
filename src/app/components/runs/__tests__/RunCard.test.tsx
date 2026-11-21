import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunResponse, RunLanding } from '../../../types/api';
import RunCard from '../RunCard';

const land = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/queries', () => {
  const idle = () => ({ mutate: vi.fn(), isPending: false });
  return {
    useAgentRunEventsQuery: () => ({ data: [], isLoading: false }),
    useCancelAgentRun: idle,
    useRetryAgentRun: idle,
    useReturnAgentRunToReady: idle,
    useResumeAgentRun: idle,
    useLandAgentRun: () => ({ mutate: land, isPending: false }),
  };
});

function approvedRun(landing: Partial<RunLanding> | null): AgentRunResponse {
  return {
    id: 'run_1',
    agent_task_id: 'task_1',
    project_id: 'project_1',
    project_title: 'Widgets',
    todo_id: 'todo_1',
    todo_title: 'Fix add',
    todo_status: 'completed',
    task_type: 'delegate_general',
    instruction: 'Fix add()',
    instruction_snapshot: 'Fix add()',
    attempt: 1,
    provider: 'orca',
    model: null,
    host_id: null,
    workspace_id: '/orca/wt',
    external_run_id: 'session_1',
    status: 'completed',
    progress: 100,
    progress_message: null,
    result_summary: 'Fixed add(); tests pass.',
    error: null,
    usage: null,
    is_adopted: true,
    landing: landing && {
      state: 'ready',
      branch: 'clawchat/fix-add-abc123',
      base_branch: 'main',
      can_open_pr: false,
      conflicts: [],
      ...landing,
    },
    created_at: '2026-11-21T00:00:00Z',
    started_at: null,
    heartbeat_at: null,
    completed_at: null,
    cancel_requested_at: null,
    updated_at: '2026-11-21T00:00:00Z',
  } as AgentRunResponse;
}

function renderCard(run: AgentRunResponse) {
  return render(
    <MemoryRouter>
      <RunCard run={run} expanded={false} onToggle={() => undefined} onReview={() => undefined} />
    </MemoryRouter>,
  );
}

function primaryButtons() {
  return screen
    .getAllByRole('button')
    .filter((button) => button.classList.contains('cc-btn--primary'));
}

describe('RunCard landing', () => {
  beforeEach(() => land.mockReset());

  it('offers one primary Merge for a repository without GitHub', () => {
    renderCard(approvedRun({}));

    expect(primaryButtons().map((button) => button.textContent)).toEqual(['Merge into main']);
    expect(screen.queryByRole('button', { name: 'Open PR' })).toBeNull();
    expect(screen.getByText(/not merged yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Merge into main' }));
    expect(land).toHaveBeenCalledWith({ runId: 'run_1', method: 'merge' });
  });

  it('makes Open PR the primary action on a GitHub repository, with Merge beside it', () => {
    renderCard(approvedRun({ can_open_pr: true }));

    expect(primaryButtons().map((button) => button.textContent)).toEqual(['Open PR']);
    const merge = screen.getByRole('button', { name: 'Merge into main' });
    expect(merge.classList.contains('cc-btn--primary')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open PR' }));
    expect(land).toHaveBeenCalledWith({ runId: 'run_1', method: 'pull_request' });
  });

  it('names the conflicting files and still lets the merge be tried again', () => {
    renderCard(approvedRun({ state: 'conflict', conflicts: ['calc.py', 'notes.md'] }));

    expect(
      screen.getByText('Merging would conflict in calc.py, notes.md. Nothing was changed.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Merge into main' })).toBeTruthy();
  });

  it('shows a merged branch without any landing button', () => {
    renderCard(approvedRun({ state: 'merged', commit: '0123456789abcdef' }));

    expect(screen.getByText('Merged into main · 0123456')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Merge|Open PR/ })).toBeNull();
  });

  it('links an opened pull request', () => {
    renderCard(
      approvedRun({ state: 'pr_opened', pr_url: 'https://github.com/acme/widgets/pull/7' }),
    );

    expect(screen.getByText('Pull request opened')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open pull request' }).getAttribute('href')).toBe(
      'https://github.com/acme/widgets/pull/7',
    );
    expect(screen.queryByRole('button', { name: /Merge|Open PR/ })).toBeNull();
  });

  it('leaves runs with nothing to land alone', () => {
    renderCard(approvedRun(null));

    expect(screen.queryByRole('button', { name: /Merge|Open PR/ })).toBeNull();
    expect(primaryButtons()).toHaveLength(0);
  });
});
