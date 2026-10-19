import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OfflineIndicator from '../OfflineIndicator';
import { useAuthStore } from '../../../stores/useAuthStore';

vi.mock('../../../services/wsClient', () => ({ wsClient: { connect: vi.fn() } }));

describe('OfflineIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ serverUrl: 'http://home.local:8000', connectionStatus: 'connected' });
  });
  afterEach(() => {
    vi.useRealTimers();
    useAuthStore.setState({ serverUrl: null, connectionStatus: 'disconnected' });
  });

  it('stays quiet while connected', () => {
    render(<OfflineIndicator />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says Home is out of reach only once the drop lasts, with Retry now', () => {
    useAuthStore.setState({ connectionStatus: 'disconnected' });
    render(<OfflineIndicator />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByRole('status')).toHaveTextContent(/^Can't reach /);
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();
  });
});
