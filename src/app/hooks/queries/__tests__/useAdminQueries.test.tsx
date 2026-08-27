import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePurgeData } from '../useAdminQueries';
import { queryKeys } from '../queryKeys';

const apiMocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../../../services/apiClient', () => ({
  default: apiMocks,
}));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('admin query invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates normalized relationships after a todo purge', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: { deleted_count: 1, target: 'todos' },
    });
    const { queryClient, wrapper } = createHarness();
    queryClient.setQueryData(queryKeys.taskRelationships, []);
    const { result } = renderHook(() => usePurgeData(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ target: 'todos', older_than_days: 30 });
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/admin/db/purge', {
      target: 'todos',
      older_than_days: 30,
    });
    expect(queryClient.getQueryState(queryKeys.taskRelationships)?.isInvalidated).toBe(true);
  });
});
