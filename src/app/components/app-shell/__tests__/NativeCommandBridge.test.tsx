import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  token: null as string | null,
  healthOK: true,
  hostPhase: 'blocked' as 'idle' | 'connected' | 'blocked',
  listeners: new Map<string, (payload?: unknown) => void>(),
  openQuickCapture: vi.fn(),
}));

vi.mock('../../../platform', () => ({
  platformApi: {
    events: {
      on: (channel: string, callback: (payload?: unknown) => void) => {
        mocks.listeners.set(channel, callback);
        return () => mocks.listeners.delete(channel);
      },
    },
  },
}));

vi.mock('../../../stores/useAuthStore', () => ({
  useAuthStore: (selector: (state: { token: string | null; healthOK: boolean }) => unknown) =>
    selector({ token: mocks.token, healthOK: mocks.healthOK }),
}));

vi.mock('../../../stores/useHostSessionStore', () => ({
  useHostSessionStore: (
    selector: (state: { phase: 'idle' | 'connected' | 'blocked' }) => unknown,
  ) => selector({ phase: mocks.hostPhase }),
}));

vi.mock('../../../stores/useQuickCaptureStore', () => ({
  useQuickCaptureStore: (selector: (state: { open: () => void }) => unknown) =>
    selector({ open: mocks.openQuickCapture }),
}));

const NativeCommandBridge = (await import('../NativeCommandBridge')).default;

function LocationProbe() {
  return <output aria-label="current route">{useLocation().pathname}</output>;
}

function renderBridge() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <NativeCommandBridge />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.token = null;
  mocks.healthOK = true;
  mocks.hostPhase = 'blocked';
  mocks.listeners.clear();
  mocks.openQuickCapture.mockClear();
});

describe('NativeCommandBridge', () => {
  it('keeps native Settings available during startup recovery', () => {
    renderBridge();

    act(() => mocks.listeners.get('open-settings')?.());

    expect(screen.getByLabelText('current route')).toHaveTextContent('/settings/app');
  });

  it('opens workspace Settings for an authenticated, ready session', () => {
    mocks.token = 'session-token';
    mocks.hostPhase = 'connected';
    renderBridge();

    act(() => mocks.listeners.get('open-settings')?.());
    expect(screen.getByLabelText('current route')).toHaveTextContent('/settings/workspace');

    act(() => fireEvent.keyDown(window, { key: ',', metaKey: true }));
    expect(screen.getByLabelText('current route')).toHaveTextContent('/settings/workspace');
  });

  it('opens recovery settings when the active server is unhealthy', () => {
    mocks.token = 'stale-session-token';
    mocks.healthOK = false;
    mocks.hostPhase = 'idle';
    renderBridge();

    act(() => mocks.listeners.get('open-settings')?.());

    expect(screen.getByLabelText('current route')).toHaveTextContent('/settings/app');
  });

  it('opens Quick Capture from the root native event listener', () => {
    mocks.token = 'session-token';
    mocks.hostPhase = 'connected';
    renderBridge();

    act(() => mocks.listeners.get('open-quick-capture')?.());

    expect(mocks.openQuickCapture).toHaveBeenCalledOnce();
  });

  it('navigates directly from a typed native route event', () => {
    renderBridge();

    act(() => mocks.listeners.get('navigate')?.('/diagnostics'));

    expect(screen.getByLabelText('current route')).toHaveTextContent('/diagnostics');
  });
});
