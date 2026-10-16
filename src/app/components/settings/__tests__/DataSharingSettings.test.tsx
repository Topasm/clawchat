import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useSettingsStore, type SharedSourceSetting } from '../../../stores/useSettingsStore';
import DataSharingSettings, { requesterLabel } from '../DataSharingSettings';

vi.mock('../../../services/apiClient', () => ({
  default: { get: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../hooks/queries', () => ({
  useDataSourceLogQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../../platform', () => ({
  platformApi: {
    runtime: { kind: 'tauri', os: 'macos', appVersion: '0.0.0-test', isDesktop: true },
    server: { selectFolder: vi.fn() },
  },
}));

const vault: SharedSourceSetting = {
  id: 'local-1',
  serverUrl: 'http://home:8000',
  root: '/Users/me/workspace',
  name: 'workspace',
  kind: 'obsidian_vault',
  includeFolders: [],
  excludeFolders: [],
};

describe('DataSharingSettings', () => {
  beforeEach(() => {
    useAuthStore.setState({ serverUrl: 'http://home:8000' });
    useSettingsStore.setState({ workerLabel: 'MacBook', sharedSources: [vault] });
  });

  it('keeps AI access and writes off until they are turned on here', () => {
    render(<DataSharingSettings />);

    const ai = screen.getByRole('switch', { name: 'AI access to workspace' });
    const writes = screen.getByRole('switch', { name: 'Allow adding tasks to workspace' });
    expect(ai).toHaveAttribute('aria-checked', 'false');
    expect(writes).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(ai);
    fireEvent.click(writes);

    expect(useSettingsStore.getState().sharedSources[0]).toMatchObject({
      aiAccess: true,
      allowWrites: true,
    });
  });

  it('names the AI as the asker in the access log', () => {
    expect(requesterLabel({ requested_by: 'chat:conv_1', requester_name: null })).toBe(
      'AI in a chat',
    );
    expect(requesterLabel({ requested_by: 'run:run_1', requester_name: null })).toBe('AI in a run');
    expect(requesterLabel({ requested_by: 'dev_1', requester_name: 'Pixel' })).toBe('Pixel');
    expect(requesterLabel({ requested_by: 'user', requester_name: null })).toBe(
      'Signed-in session',
    );
  });
});
