import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../../../stores/useAuthStore';
import { useConversationsQuery, useMessagesQuery } from '../useChatQueries';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({ default: apiMocks }));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function message(id: string, createdAt: string) {
  return {
    id,
    conversation_id: 'conversation-1',
    role: 'user',
    content: id,
    created_at: createdAt,
  };
}

describe('chat queries', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
    apiMocks.post.mockReset();
    useAuthStore.setState({ serverUrl: 'https://host.example' });
  });

  it('loads the newest message page first and appends earlier pages', async () => {
    apiMocks.get.mockImplementation((_url, config: { params: { page: number } }) => {
      if (config.params.page === 1) {
        return Promise.resolve({
          data: {
            items: [
              message('newest', '2026-01-03T00:00:00Z'),
              message('newer', '2026-01-02T00:00:00Z'),
            ],
            page: 1,
            limit: 2,
            total: 3,
          },
        });
      }
      return Promise.resolve({
        data: {
          items: [message('oldest', '2026-01-01T00:00:00Z')],
          page: 2,
          limit: 2,
          total: 3,
        },
      });
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useMessagesQuery('conversation-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((item) => item._id)).toEqual(['newest', 'newer']);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() =>
      expect(result.current.data?.map((item) => item._id)).toEqual(['newest', 'newer', 'oldest']),
    );
    expect(apiMocks.get).toHaveBeenLastCalledWith('/chat/conversations/conversation-1/messages', {
      params: { page: 2, limit: 50 },
    });
  });

  it('requests the expanded recent-conversation window', async () => {
    apiMocks.get.mockResolvedValue({
      data: {
        items: [
          {
            id: 'empty-conversation',
            title: 'New Conversation',
            last_message: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      },
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useConversationsQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMocks.get).toHaveBeenCalledWith('/chat/conversations', {
      params: { limit: 100 },
    });
    expect(result.current.data?.[0]).toMatchObject({
      id: 'empty-conversation',
      last_message: null,
    });
  });
});
