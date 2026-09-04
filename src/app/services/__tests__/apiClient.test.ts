import { AxiosError, type AxiosAdapter } from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../../stores/useAuthStore';
import apiClient from '../apiClient';
import { getOfflineQueueScope, offlineQueue } from '../offlineQueue';

function createToken(subject: string): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'none' })}.${encode({ sub: subject })}.signature`;
}

const networkFailureAdapter: AxiosAdapter = (config) =>
  Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config));

describe('apiClient offline mutation policy', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      serverUrl: 'https://host.example',
      token: createToken('user-1'),
      relayUrl: null,
      hostId: null,
      hostPublicKey: null,
    });
  });

  it('queues an explicitly replayable offline mutation', async () => {
    const scope = getOfflineQueueScope(useAuthStore.getState());

    const response = await apiClient.post(
      '/todos',
      { title: 'Queued task' },
      { adapter: networkFailureAdapter, queueOfflineMutation: true },
    );

    expect(response.status).toBe(0);
    expect(response.statusText).toBe('offline-queued');
    expect(offlineQueue.getItems(scope)).toEqual([
      expect.objectContaining({
        method: 'post',
        url: '/todos',
        data: { title: 'Queued task' },
      }),
    ]);
  });

  it('rejects mutations by default without adding them to the offline queue', async () => {
    const scope = getOfflineQueueScope(useAuthStore.getState());

    await expect(
      apiClient.post(
        '/todos/task-1/plan/apply',
        { proposal_id: 'proposal-1' },
        { adapter: networkFailureAdapter },
      ),
    ).rejects.toMatchObject({ code: 'ERR_NETWORK' });

    expect(offlineQueue.getCount(scope)).toBe(0);
  });

  it('rejects a non-JSON payload even when offline replay was requested', async () => {
    const scope = getOfflineQueueScope(useAuthStore.getState());
    const body = new FormData();
    body.append('file', new Blob(['contents']), 'note.txt');

    await expect(
      apiClient.post('/attachments', body, {
        adapter: networkFailureAdapter,
        queueOfflineMutation: true,
      }),
    ).rejects.toMatchObject({ code: 'ERR_NETWORK' });

    expect(offlineQueue.getCount(scope)).toBe(0);
  });
});
