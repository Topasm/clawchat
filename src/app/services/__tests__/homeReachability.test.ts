import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  HomeUnreachableError,
  isHomeReachableNow,
  OUTAGE_GRACE_MS,
  requireHome,
} from '../homeReachability';

describe('homeReachability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ serverUrl: 'http://home.local:8000', connectionStatus: 'connected' });
    isHomeReachableNow();
  });
  afterEach(() => {
    vi.useRealTimers();
    useAuthStore.setState({ serverUrl: null, connectionStatus: 'disconnected' });
  });

  it('keeps Home reachable through a blink and calls it out of reach once the drop lasts', () => {
    useAuthStore.setState({ connectionStatus: 'reconnecting' });
    expect(isHomeReachableNow()).toBe(true);
    expect(() => requireHome()).not.toThrow();

    vi.advanceTimersByTime(OUTAGE_GRACE_MS);
    expect(isHomeReachableNow()).toBe(false);
    expect(() => requireHome()).toThrow(HomeUnreachableError);

    useAuthStore.setState({ connectionStatus: 'connected' });
    expect(isHomeReachableNow()).toBe(true);
  });

  it('counts a drop from when it started, not from each status change', () => {
    useAuthStore.setState({ connectionStatus: 'reconnecting' });
    vi.advanceTimersByTime(OUTAGE_GRACE_MS - 1000);
    useAuthStore.setState({ connectionStatus: 'disconnected' });
    vi.advanceTimersByTime(1000);
    expect(isHomeReachableNow()).toBe(false);
  });
});
