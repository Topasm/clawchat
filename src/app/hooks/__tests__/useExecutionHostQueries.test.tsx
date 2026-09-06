import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useBindProjectWorkspace,
  useDeleteProjectHostPath,
  useSetProjectExecutionHost,
  useSetProjectHostPath,
} from '../queries/useExecutionHostQueries';
import { queryKeys } from '../queries/queryKeys';

const api = vi.hoisted(() => ({ put: vi.fn(), delete: vi.fn() }));
vi.mock('../../services/apiClient', () => ({ default: api }));

function setup(useAction: () => () => Promise<unknown>) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  for (const key of [
    queryKeys.projects,
    queryKeys.project('p1'),
    queryKeys.projectWorkspace('p1'),
    queryKeys.project('p2'),
  ]) {
    client.setQueryData(key, { saved: true });
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(useAction, { wrapper }) };
}

const actions = [
  {
    name: 'save path',
    useAction: function usePathAction() {
      const mutation = useSetProjectHostPath('p1');
      return () => mutation.mutateAsync({ host_id: 'h1', path: '/papers' });
    },
  },
  {
    name: 'choose host',
    useAction: function useHostAction() {
      const mutation = useSetProjectExecutionHost('p1');
      return () => mutation.mutateAsync({ host_id: 'h1' });
    },
  },
  {
    name: 'forget path',
    useAction: function useForgetAction() {
      const mutation = useDeleteProjectHostPath('p1');
      return () => mutation.mutateAsync('h1');
    },
  },
  {
    name: 'bind local folder',
    useAction: function useBindAction() {
      const mutation = useBindProjectWorkspace();
      return () => mutation.mutateAsync({ projectId: 'p1', hostId: 'h1', path: '/papers' });
    },
  },
];

describe('workspace mutation cache consistency', () => {
  beforeEach(() => {
    api.put.mockReset().mockResolvedValue({ data: {} });
    api.delete.mockReset().mockResolvedValue({ data: {} });
  });

  it.each(actions)(
    '$name refreshes the list, detail and workspace, but not unrelated projects',
    async ({ useAction }) => {
      const { client, result } = setup(useAction);
      await act(async () => {
        await result.current();
      });
      for (const key of [
        queryKeys.projects,
        queryKeys.project('p1'),
        queryKeys.projectWorkspace('p1'),
      ]) {
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      }
      expect(client.getQueryState(queryKeys.project('p2'))?.isInvalidated).toBe(false);
    },
  );

  it('refreshes all location surfaces after a partially successful bind', async () => {
    api.put
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error('Host unavailable'));
    const { client, result } = setup(actions[3].useAction);
    await act(async () => {
      await expect(result.current()).rejects.toThrow('Host unavailable');
    });
    expect(api.put).toHaveBeenCalledTimes(2);
    for (const key of [
      queryKeys.projects,
      queryKeys.project('p1'),
      queryKeys.projectWorkspace('p1'),
    ]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
