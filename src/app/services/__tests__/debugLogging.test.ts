import { afterEach, describe, expect, it } from 'vitest';
import {
  clearDebugLogs,
  debugResource,
  getDebugSnapshot,
  recordDebug,
  serializeDebugLogs,
  setDebugLogging,
  subscribeDebug,
} from '../debugLogging';
import apiClient from '../apiClient';
import { useAuthStore } from '../../stores/useAuthStore';

afterEach(() => {
  setDebugLogging(false);
  clearDebugLogs();
});

describe('opt-in diagnostic capture', () => {
  it('stops immediately and retains only the latest 500 entries until cleared', () => {
    recordDebug({ event: 'request' });
    expect(getDebugSnapshot().entries).toHaveLength(0);
    setDebugLogging(true);
    for (let i = 0; i < 600; i++) recordDebug({ event: 'response', durationMs: i });
    expect(getDebugSnapshot().entries).toHaveLength(500);
    expect(getDebugSnapshot().entries[0].durationMs).toBe(100);
    setDebugLogging(false);
    recordDebug({ event: 'runtime-error' });
    expect(getDebugSnapshot().entries.at(-1)?.durationMs).toBe(599);
    clearDebugLogs();
    expect(getDebugSnapshot().entries).toHaveLength(0);
  });

  it('notifies live viewers and unregisters error listeners on disable', () => {
    let updates = 0;
    const unsubscribe = subscribeDebug(() => updates++);
    setDebugLogging(true);
    window.dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE message token=secret' }));
    expect(getDebugSnapshot().entries.at(-1)?.event).toBe('runtime-error');
    expect(updates).toBe(2);
    unsubscribe();
    setDebugLogging(false);
    window.dispatchEvent(new ErrorEvent('error', { message: 'another secret' }));
    expect(updates).toBe(2);
    expect(getDebugSnapshot().entries).toHaveLength(2);
    expect(serializeDebugLogs({ os: 'macos', appVersion: 'test', kind: 'tauri' })).not.toContain(
      'secret',
    );
  });

  it('keeps only known resource categories, never host IDs or query values', () => {
    expect(debugResource('https://private-host/api/todos/private-title?token=secret')).toBe(
      'todos',
    );
    expect(debugResource('/my-private-project')).toBe('other');
    expect(debugResource('/api/search?q=private')).toBe('search');
  });

  it('captures real API status and timing without request or response content', async () => {
    useAuthStore.setState({ serverUrl: 'https://private-host', token: 'SECRET' });
    setDebugLogging(true);
    await apiClient.post(
      '/todos/private-id?token=SECRET',
      { title: 'PRIVATE_TITLE' },
      {
        adapter: async (config) => ({
          config,
          status: 201,
          statusText: 'OK',
          headers: {},
          data: { content: 'PRIVATE_BODY' },
        }),
      },
    );
    expect(getDebugSnapshot().entries.at(-1)).toMatchObject({
      event: 'response',
      method: 'POST',
      status: 201,
      resource: 'todos',
    });
    const output = serializeDebugLogs({ os: 'linux', appVersion: 'test', kind: 'tauri' });
    for (const sensitive of [
      'private-host',
      'private-id',
      'SECRET',
      'PRIVATE_TITLE',
      'PRIVATE_BODY',
    ])
      expect(output).not.toContain(sensitive);
  });
});
