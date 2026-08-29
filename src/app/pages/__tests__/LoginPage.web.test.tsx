import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../config/ThemeProvider';
import { useAuthStore } from '../../stores/useAuthStore';
import LoginPage from '../LoginPage';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

beforeEach(() => {
  useAuthStore.setState({ token: null, isLoading: false, login: vi.fn() });
});

describe('LoginPage in the browser', () => {
  it('still opens straight onto the sign-in form', () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </ThemeProvider>,
    );

    // The host panel is desktop-only; a web build has no local sidecar to
    // report on and must keep the credential form as its first screen.
    expect(screen.queryByTestId('host-startup-panel')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your PIN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^login$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan qr code/i })).toBeInTheDocument();
  });
});
