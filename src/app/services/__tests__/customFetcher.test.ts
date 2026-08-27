import { describe, expect, it, vi } from 'vitest';
import apiClient from '../apiClient';
import {
  customFetcher,
  isFailClosedGeneratedMutation,
  normalizeGeneratedApiUrl,
} from '../customFetcher';

vi.mock('../apiClient', () => ({
  default: {
    request: vi.fn().mockResolvedValue({ data: { ok: true } }),
  },
}));

describe('customFetcher generated API boundary', () => {
  it('removes the duplicated API prefix expected by apiClient', () => {
    expect(normalizeGeneratedApiUrl('/api/todos')).toBe('/todos');
    expect(normalizeGeneratedApiUrl('/api/health')).toBe('/health');
    expect(normalizeGeneratedApiUrl('/todos')).toBe('/todos');
  });

  it.each([
    ['/api/todos/task-1/plan/generate'],
    ['/api/todos/task-1/plan/apply'],
    ['/api/todos/task-1/plan/dismiss'],
    ['/api/change-sets/change-1/revert'],
  ])('marks revision-sensitive mutation %s as fail-closed', (url) => {
    expect(isFailClosedGeneratedMutation('POST', url)).toBe(true);
  });

  it('does not opt ordinary mutations or reads out of the offline queue', () => {
    expect(isFailClosedGeneratedMutation('POST', '/api/todos')).toBe(false);
    expect(isFailClosedGeneratedMutation('GET', '/api/todos/task-1/plan/apply')).toBe(false);
  });

  it('passes normalized URLs and fail-closed policy to apiClient', async () => {
    await customFetcher({
      url: '/api/todos/task-1/plan/apply',
      method: 'POST',
      data: { proposal_id: 'proposal-1' },
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/todos/task-1/plan/apply',
        method: 'POST',
        queueOfflineMutation: false,
      }),
    );
  });
});
