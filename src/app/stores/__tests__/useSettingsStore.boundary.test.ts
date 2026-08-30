import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({ default: api }));

const { DEFAULT_SETTINGS, useSettingsStore } = await import('../useSettingsStore');

beforeEach(() => {
  vi.useFakeTimers();
  api.get.mockReset();
  api.put.mockReset();
  useSettingsStore.setState({ ...DEFAULT_SETTINGS });
});

describe('settings persistence boundary', () => {
  it('keeps application preferences local without contacting a workspace server', async () => {
    useSettingsStore.getState().setFontSize(19);
    useSettingsStore.getState().setNotificationsEnabled(false);
    useSettingsStore.getState().setSimpleMode(true);

    await vi.advanceTimersByTimeAsync(600);

    expect(useSettingsStore.getState().fontSize).toBe(19);
    expect(useSettingsStore.getState().notificationsEnabled).toBe(false);
    expect(useSettingsStore.getState().simpleMode).toBe(true);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('resets application preferences without changing active workspace settings', () => {
    useSettingsStore.setState({
      fontSize: 21,
      simpleMode: true,
      systemPrompt: 'Workspace prompt',
    });

    useSettingsStore.getState().resetApplicationPreferences();

    expect(useSettingsStore.getState().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(useSettingsStore.getState().simpleMode).toBe(false);
    expect(useSettingsStore.getState().systemPrompt).toBe('Workspace prompt');
  });

  it('syncs only workspace-owned settings', async () => {
    api.put.mockResolvedValue({ data: {} });

    useSettingsStore.getState().setSystemPrompt('Workspace prompt');
    await vi.advanceTimersByTimeAsync(600);

    expect(api.put).toHaveBeenCalledWith('/settings', {
      llmModel: DEFAULT_SETTINGS.llmModel,
      temperature: DEFAULT_SETTINGS.temperature,
      systemPrompt: 'Workspace prompt',
      maxTokens: DEFAULT_SETTINGS.maxTokens,
      streamResponses: DEFAULT_SETTINGS.streamResponses,
    });
  });

  it('does not overwrite local application preferences during workspace refresh', async () => {
    useSettingsStore.setState({ fontSize: 20 });
    api.get.mockResolvedValue({
      data: {
        settings: {
          fontSize: 12,
          systemPrompt: 'Remote workspace prompt',
        },
      },
    });

    await useSettingsStore.getState().fetchSettings();

    expect(useSettingsStore.getState().fontSize).toBe(20);
    expect(useSettingsStore.getState().systemPrompt).toBe('Remote workspace prompt');
  });
});
