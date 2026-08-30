import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoLogin } from '../useAutoLogin';
import { useAuthStore } from '../../stores/useAuthStore';
import { useHostSessionStore } from '../../stores/useHostSessionStore';

const start = vi.fn().mockResolvedValue(undefined);
const stop = vi.fn();
const signIn = vi.fn().mockResolvedValue(undefined);

function Harness() {
  useAutoLogin();
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  useHostSessionStore.setState({ start, stop, signIn, phase: 'checking' });
  useAuthStore.setState({ token: null, isLoading: false });
});

describe('useAutoLogin', () => {
  it('drives the host handshake exactly once per signed-out session', () => {
    const view = render(<Harness />);
    view.rerender(<Harness />);

    // The handshake state lives in the store precisely so that a second reader
    // (the login screen) cannot turn into a second sign-in attempt.
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not start a handshake while the session is still rehydrating', () => {
    useAuthStore.setState({ isLoading: true });
    render(<Harness />);

    expect(start).not.toHaveBeenCalled();
  });

  it('revalidates a restored local session before the workspace mounts', () => {
    useAuthStore.setState({ token: 'session-token' });
    render(<Harness />);

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('drops the status watch when nothing is listening any more', () => {
    render(<Harness />).unmount();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('silently reopens a connected local workspace if its token is cleared', () => {
    useHostSessionStore.setState({ phase: 'connected' });
    render(<Harness />);

    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
