import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsPage from '../SettingsPage';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  default: apiMocks,
}));

vi.mock('../../hooks/usePlatform', () => ({
  default: () => ({ isDesktop: false }),
}));

vi.mock('../../hooks/useSettingsExportImport', () => ({
  default: () => ({
    fileInputRef: { current: null },
    handleExport: vi.fn(),
    onFileSelected: vi.fn(),
  }),
}));

vi.mock('../../components/pairing/PairingCodeDisplay', () => ({ default: () => null }));
vi.mock('../../components/shared/CalendarSubscriptionCard', () => ({ default: () => null }));
vi.mock('../../components/shared/ObsidianStatusCard', () => ({ default: () => null }));

const providerState = {
  active_provider: 'openclaw',
  openclaw_connected: true,
  claude_code_status: 'not_installed',
  claude_code_version: null,
  codex_api_status: 'not_configured',
  codex_api_configured: false,
  codex_api_key_persistent: true,
  codex_model: 'gpt-5.3-codex',
};

describe('SettingsPage Codex provider', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
    apiMocks.post.mockReset();
    apiMocks.put.mockReset();
    apiMocks.get.mockImplementation((path: string) => {
      if (path === '/admin/ai/provider') return Promise.resolve({ data: providerState });
      if (path === '/obsidian/status') return Promise.resolve({ data: { vaultPath: '' } });
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
  });

  it('configures and activates Codex without echoing an existing key', async () => {
    apiMocks.put.mockResolvedValue({
      data: {
        ...providerState,
        active_provider: 'codex',
        codex_api_status: 'available',
        codex_api_configured: true,
      },
    });

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByText('Not configured — add an OpenAI API key')).toBeInTheDocument();

    const input = screen.getByLabelText('OpenAI API key');
    fireEvent.change(input, { target: { value: 'sk-user-entered-secret-key-for-codex-provider' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Use' }));

    await waitFor(() =>
      expect(apiMocks.put).toHaveBeenCalledWith(
        '/admin/ai/codex',
        { api_key: 'sk-user-entered-secret-key-for-codex-provider' },
        { queueOfflineMutation: false },
      ),
    );
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.getByText('Using Codex API — gpt-5.3-codex')).toBeInTheDocument();
    expect(screen.getByText('Ready — gpt-5.3-codex')).toBeInTheDocument();
  });
});
