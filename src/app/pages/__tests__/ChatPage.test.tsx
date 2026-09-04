import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatPage from '../ChatPage';

const mocks = vi.hoisted(() => ({
  resume: vi.fn(),
}));

vi.mock('../../hooks/queries', () => ({
  useMessagesQuery: () => ({
    data: [],
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useConversationsQuery: () => ({
    data: [
      {
        id: 'conv-1',
        title: 'Agent thread',
        created_at: '2026-09-04T00:00:00Z',
        updated_at: '2026-09-04T00:00:00Z',
      },
    ],
  }),
  useProjectsQuery: () => ({ data: [] }),
  useDeleteMessage: () => ({ mutate: vi.fn() }),
  useRegenerateMessage: () => ({ mutateAsync: vi.fn() }),
  useResumeAgentRun: () => ({ mutateAsync: mocks.resume }),
  useRunsAwaitingInputQuery: () => ({
    data: [{ id: 'run-1', status: 'waiting_input', conversation_id: 'conv-1' }],
  }),
}));

describe('ChatPage agent answer mode', () => {
  beforeEach(() => mocks.resume.mockReset().mockResolvedValue({}));

  it('sends the composer text as a run follow-up for a waiting thread', async () => {
    render(
      <MemoryRouter initialEntries={['/chats/conv-1']}>
        <Routes>
          <Route path="/chats/:conversationId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Answering the agent')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Answer the agent...'), {
      target: { value: 'Use the concise option' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(mocks.resume).toHaveBeenCalledWith({
        runId: 'run-1',
        followUp: 'Use the concise option',
      }),
    );
  });
});
