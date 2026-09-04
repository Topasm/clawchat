import { beforeEach, describe, expect, it } from 'vitest';
import { getWorkerDeviceId } from '../workerIdentity';

describe('worker identity', () => {
  beforeEach(() => localStorage.clear());

  it('persists one stable id independently of the editable worker label', () => {
    const first = getWorkerDeviceId();
    const second = getWorkerDeviceId();

    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('repairs a malformed stored id instead of retrying invalid registration forever', () => {
    localStorage.setItem('clawchat-worker-device-id', 'not-a-uuid');

    expect(getWorkerDeviceId()).not.toBe('not-a-uuid');
  });
});
