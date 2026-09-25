import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage } from '../../../i18n';
import AIModelSettings from '../AIModelSettings';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../../services/apiClient', () => ({ default: api }));

function renderModels(provider = 'codex_cli') {
  const saved = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AIModelSettings provider={provider} onSaved={saved} />
    </QueryClientProvider>,
  );
  return saved;
}

describe('AI model settings', () => {
  beforeEach(async () => {
    await changeAppLanguage('en');
    api.get.mockReset();
    api.put.mockReset();
    api.get.mockResolvedValue({
      data: {
        provider: 'codex_cli',
        model: 'gpt-6-luna',
        persistent: true,
        models: ['gpt-6-luna', 'future-model'],
        source: 'cli',
      },
    });
  });

  it('loads CLI-discovered models and saves a future model without an allowlist', async () => {
    api.put.mockResolvedValue({
      data: { provider: 'codex_cli', model: 'future-model', persistent: true },
    });
    const saved = renderModels();
    const input = await screen.findByDisplayValue('gpt-6-luna');
    expect(document.querySelector('option[value="future-model"]')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'future-model' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/admin/ai/models/codex_cli',
        { model: 'future-model' },
        { queueOfflineMutation: false },
      ),
    );
    expect(await screen.findByText('Model saved for this server.')).toBeInTheDocument();
    expect(saved).toHaveBeenCalledOnce();
  });

  it('supports clearing the CLI override and reports session-only storage', async () => {
    api.put.mockResolvedValue({ data: { provider: 'codex_cli', model: '', persistent: false } });
    renderModels();
    fireEvent.change(await screen.findByDisplayValue('gpt-6-luna'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
    expect(await screen.findByText('Model saved until the server restarts.')).toBeInTheDocument();
  });

  it('labels fallback suggestions and preserves the draft after a save failure', async () => {
    api.get.mockResolvedValue({
      data: {
        provider: 'codex',
        model: 'gpt-6-sol',
        persistent: false,
        models: ['gpt-6-sol'],
        source: 'suggestions',
      },
    });
    api.put.mockRejectedValue(new Error('offline'));
    renderModels('codex');
    const input = await screen.findByDisplayValue('gpt-6-sol');
    expect(
      screen.getByText(
        'Live model discovery unavailable. Suggestions do not confirm account access.',
      ),
    ).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Save model' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'custom-model' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
    expect(await screen.findByText('Could not save the model.')).toBeInTheDocument();
    expect(input).toHaveValue('custom-model');
  });
});
