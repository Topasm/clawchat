import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../queryKeys';
import { useObsidianScan } from '../useObsidianQueries';

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({ default: apiMocks }));

function createHarness() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  queryClient.setQueryData(queryKeys.todos, []);
  queryClient.setQueryData(queryKeys.projects, []);
  queryClient.setQueryData(queryKeys.taskGraphInsightScope(null), { graph_revision: 1 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('Obsidian task invalidation', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
  });

  it('refreshes projects and graph insights after an inbound vault scan', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: {
        files_scanned: 3,
        markers_found: 2,
        changes_detected: 1,
        changes_applied: 1,
        errors: 0,
        duration_ms: 12,
      },
    });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useObsidianScan(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
      true,
    );
  });
});
