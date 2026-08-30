import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ token: null as string | null, isLoading: true }));
const hostState = vi.hoisted(() => ({ phase: 'blocked' }));

vi.mock('./app/stores/useAuthStore', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));
vi.mock('./app/stores/useHostSessionStore', () => ({
  useHostSessionStore: (selector: (state: typeof hostState) => unknown) => selector(hostState),
}));
vi.mock('./app/hooks/useAutoLogin', () => ({ useAutoLogin: () => undefined }));
vi.mock('./app/services/startupPerformance', () => ({
  markStartupPhaseAfterPaint: () => () => undefined,
}));
vi.mock('./app/services/startupSurface', () => ({ hideStartupShell: vi.fn() }));
vi.mock('./app/pages/ConnectionCenterPage', () => ({
  default: () => <div>Public connection center</div>,
}));
vi.mock('./app/pages/DiagnosticsPage', () => ({
  default: () => <div>Public diagnostics</div>,
}));

const AppRouter = (await import('./router')).default;

describe('public shell routes', () => {
  it.each([
    ['/connections', 'Public connection center'],
    ['/diagnostics', 'Public diagnostics'],
  ])('keeps %s available during auth rehydration and a blocked host', async (path, label) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRouter />
      </MemoryRouter>,
    );

    expect(await screen.findByText(label)).toBeInTheDocument();
  });
});
