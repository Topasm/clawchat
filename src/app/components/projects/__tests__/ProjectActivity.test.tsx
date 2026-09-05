import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectOverviewResponse } from '../../../types/api';
import ProjectActivity from '../ProjectActivity';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../../../hooks/useOpenRunThread', () => ({ default: () => mocks.open }));
vi.mock('../../chat-panel/ChatPanelControllerContext', () => ({
  useChatPanelController: () => ({ open: vi.fn() }),
}));
vi.mock('../../../hooks/queries', () => ({
  useAgentRunsQuery: () => ({
    data: [{ id: 'question-run', status: 'waiting_input', todo_title: 'Question task' }],
  }),
  useReviewsQuery: () => ({
    data: [
      {
        id: 'review',
        subject_type: 'agent_run',
        subject_title: 'Review task',
        metadata: { run_id: 'review-run' },
      },
    ],
  }),
  useConversationsQuery: () => ({ data: [] }),
}));

describe('ProjectActivity attention summary', () => {
  it('opens the correct question and review runs without requiring the conversation list', () => {
    render(
      <MemoryRouter>
        <ProjectActivity
          project={{ id: 'project', title: 'Project' } as ProjectOverviewResponse}
          todos={[]}
          attentionOnly
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('heading', { name: 'Agent runs' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Question task/ }));
    expect(mocks.open).toHaveBeenLastCalledWith('question-run', 'Question task');
    fireEvent.click(screen.getByRole('button', { name: /Review task/ }));
    expect(mocks.open).toHaveBeenLastCalledWith('review-run', 'Review task');
  });
});
