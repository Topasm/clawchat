import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OfflineIndicator from '../OfflineIndicator';
import { useAuthStore } from '../../../stores/useAuthStore';
import { wsClient } from '../../../services/wsClient';

vi.mock('../../../services/wsClient', () => ({ wsClient: { connect: vi.fn() } }));

describe('OfflineIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({
      serverUrl: 'http://home.local:8000',
      token: 'token',
      connectionStatus: 'connected',
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    useAuthStore.setState({ serverUrl: null, token: null, connectionStatus: 'disconnected' });
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

  it('retries by reconnecting the socket, without claiming Home answered', () => {
    const online = vi.fn();
    window.addEventListener('online', online);
    useAuthStore.setState({ connectionStatus: 'disconnected' });
    render(<OfflineIndicator />);
    act(() => vi.advanceTimersByTime(4000));
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    window.removeEventListener('online', online);

    expect(wsClient.connect).toHaveBeenCalledWith('http://home.local:8000', 'token');
    expect(online).not.toHaveBeenCalled();
    expect(useAuthStore.getState().connectionStatus).toBe('disconnected');
    expect(screen.getByRole('status')).toHaveTextContent(/^Can't reach /);
  });
});
