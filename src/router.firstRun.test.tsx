import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  token: null as string | null,
  isLoading: false,
  healthOK: true,
}));
const hostState = vi.hoisted(() => ({ phase: 'blocked' }));

vi.mock('./app/types/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./app/types/platform')>()),
  IS_DESKTOP: true,
}));
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
vi.mock('./app/pages/OnboardingPage', () => ({ default: () => <div>Setup wizard</div> }));
vi.mock('./app/pages/LoginPage', () => ({ default: () => <div>Sign-in screen</div> }));
vi.mock('./app/pages/AppSettingsPage', () => ({
  default: () => <div>Application settings</div>,
}));

const { useFirstRunStore } = await import('./app/stores/useFirstRunStore');
const AppRouter = (await import('./router')).default;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRouter />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState.token = null;
  authState.isLoading = false;
  useFirstRunStore.setState({ outcome: null, finishedAt: null });
});

describe('first-run setup routing on desktop', () => {
  it('opens setup instead of the stopped-server screen on a new profile', async () => {
    renderAt('/');

    expect(await screen.findByText('Setup wizard')).toBeInTheDocument();
    expect(screen.queryByText('Sign-in screen')).not.toBeInTheDocument();
  });

  it.each(['completed', 'skipped'] as const)(
    'does not open setup again once %s',
    async (outcome) => {
      useFirstRunStore.setState({ outcome });
      renderAt('/');

      expect(await screen.findByText('Sign-in screen')).toBeInTheDocument();
      expect(screen.queryByText('Setup wizard')).not.toBeInTheDocument();
    },
  );

  it('reopens setup at /onboarding after it was finished', async () => {
    useFirstRunStore.setState({ outcome: 'completed' });
    authState.token = 'session';
    renderAt('/onboarding');

    expect(await screen.findByText('Setup wizard')).toBeInTheDocument();
  });

  it('keeps settings reachable while setup is pending', async () => {
    renderAt('/settings/app');

    expect(await screen.findByText('Application settings')).toBeInTheDocument();
  });
});
