import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PairingCodeDisplay from '../components/pairing/PairingCodeDisplay';
import CalendarSubscriptionCard from '../components/shared/CalendarSubscriptionCard';
import ObsidianStatusCard from '../components/shared/ObsidianStatusCard';
import SegmentedControl from '../components/shared/SegmentedControl';
import SettingsRow from '../components/shared/SettingsRow';
import SettingsSection from '../components/shared/SettingsSection';
import { StatusDot } from '../components/shared/WorkspacePrimitives';
import useSettingsExportImport from '../hooks/useSettingsExportImport';
import usePlatform from '../hooks/usePlatform';
import { platformApi } from '../platform';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../stores/useAuthStore';
import { useToastStore } from '../stores/useToastStore';
import { LOCAL_WORKSPACE_ID, useWorkspaceStore } from '../stores/useWorkspaceStore';
import { openObsidianVault } from '../utils/openObsidian';

interface AIProviderState {
  active_provider: string;
  openclaw_connected: boolean;
  claude_code_status: string;
  claude_code_version: string | null;
}

/** Settings backed by the currently connected workspace server. */
export default function SettingsPage() {
  const navigate = useNavigate();
  const { isDesktop } = usePlatform();
  const token = useAuthStore((state) => state.token);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const logout = useAuthStore((state) => state.logout);
  const addToast = useToastStore((state) => state.addToast);
  const isHost = useWorkspaceStore((state) => state.activeWorkspaceId === LOCAL_WORKSPACE_ID);
  const { fileInputRef, handleExport, onFileSelected } = useSettingsExportImport();
  const [obsidianVaultPath, setObsidianVaultPath] = useState('');
  const [aiProvider, setAiProvider] = useState<AIProviderState | null>(null);
  const [aiProviderSwitching, setAiProviderSwitching] = useState(false);
  const [claudeCodeChecking, setClaudeCodeChecking] = useState(false);

  useEffect(() => {
    apiClient
      .get('/admin/ai/provider')
      .then((response) => setAiProvider(response.data))
      .catch(() => {});
  }, []);

  const handleSwitchProvider = useCallback(
    async (provider: string) => {
      setAiProviderSwitching(true);
      try {
        const response = await apiClient.post('/admin/ai/provider', { provider });
        setAiProvider(response.data);
        addToast(
          'success',
          `Switched to ${provider === 'claude_code' ? 'Claude Code' : 'OpenClaw'}`,
        );
      } catch (error: unknown) {
        const message =
          (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'Failed to switch provider';
        addToast('error', message);
      } finally {
        setAiProviderSwitching(false);
      }
    },
    [addToast],
  );

  const handleRecheckClaudeCode = useCallback(async () => {
    setClaudeCodeChecking(true);
    try {
      const response = await apiClient.post('/admin/ai/claude-code/check');
      setAiProvider((previous) =>
        previous
          ? {
              ...previous,
              claude_code_status: response.data.status,
              claude_code_version: response.data.version,
            }
          : previous,
      );
      addToast(
        'success',
        `Claude Code: ${response.data.status}${response.data.version ? ` (${response.data.version})` : ''}`,
      );
    } catch {
      addToast('error', 'Failed to check Claude Code status');
    } finally {
      setClaudeCodeChecking(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isDesktop) {
      platformApi.server
        .getConfig()
        .then((config) => setObsidianVaultPath(config.obsidianVaultPath ?? ''));
      return;
    }

    apiClient
      .get('/obsidian/status')
      .then((response) => setObsidianVaultPath(response.data?.vaultPath ?? ''))
      .catch(() => {});
  }, [isDesktop]);

  return (
    <div className="cc-settings-page">
      <div className="cc-page-header">
        <div className="cc-page-header__title">Workspace Settings</div>
      </div>

      <SettingsSection title="Application">
        <SettingsRow
          label="Application settings"
          sublabel="Appearance, notifications, updates, and local preferences"
        >
          <button
            type="button"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            onClick={() => navigate('/settings/app')}
          >
            Open
          </button>
        </SettingsRow>
        {isDesktop && (
          <SettingsRow label="Connections" sublabel="Local server policy and remote workspaces">
            <button
              type="button"
              className="cc-btn cc-btn--secondary cc-btn--compact"
              onClick={() => navigate('/connections')}
            >
              Manage
            </button>
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title="AI">
        <SettingsRow label="System prompt">
          <button
            type="button"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            onClick={() => navigate('/settings/system-prompt')}
          >
            Edit
          </button>
        </SettingsRow>
        {aiProvider && (
          <>
            <SettingsRow
              label="AI Provider"
              sublabel={
                aiProvider.active_provider === 'claude_code'
                  ? 'Using Claude Code CLI'
                  : 'Using OpenClaw gateway'
              }
            >
              <SegmentedControl
                ariaLabel="AI provider"
                options={[
                  { label: 'OpenClaw', value: 'openclaw' },
                  { label: 'Claude Code', value: 'claude_code' },
                ]}
                value={aiProvider.active_provider}
                onChange={(provider) => !aiProviderSwitching && void handleSwitchProvider(provider)}
              />
            </SettingsRow>
            <SettingsRow
              label="Claude Code CLI"
              sublabel={
                aiProvider.claude_code_status === 'available'
                  ? `Installed${aiProvider.claude_code_version ? ` — ${aiProvider.claude_code_version}` : ''}`
                  : aiProvider.claude_code_status === 'not_installed'
                    ? 'Not installed'
                    : aiProvider.claude_code_status === 'not_authenticated'
                      ? 'Not authenticated — run `claude login`'
                      : `Status: ${aiProvider.claude_code_status}`
              }
            >
              <div className="cc-settings-inline-actions">
                <StatusDot
                  className="cc-settings-status-dot"
                  tone={aiProvider.claude_code_status === 'available' ? 'success' : 'neutral'}
                />
                <button
                  type="button"
                  className="cc-btn cc-btn--secondary cc-btn--compact"
                  onClick={() => void handleRecheckClaudeCode()}
                  disabled={claudeCodeChecking}
                >
                  {claudeCodeChecking ? 'Checking...' : 'Recheck'}
                </button>
              </div>
            </SettingsRow>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Workspace">
        <SettingsRow label="Calendar view" sublabel="Optional planning view">
          <button
            type="button"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            onClick={() => navigate('/calendar')}
          >
            Open
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Import / Export">
        <SettingsRow
          label="Export all data"
          sublabel="Download todos, events, and conversations as JSON"
        >
          <button
            type="button"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            onClick={handleExport}
          >
            Export
          </button>
        </SettingsRow>
        <SettingsRow label="Import data" sublabel="Restore from a previously exported JSON file">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={onFileSelected}
            className="cc-hidden"
          />
          <button
            type="button"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            onClick={() => fileInputRef.current?.click()}
          >
            Import
          </button>
        </SettingsRow>
      </SettingsSection>

      <CalendarSubscriptionCard />
      <ObsidianStatusCard />

      {isDesktop && isHost && (
        <SettingsSection title="Obsidian Desktop">
          <SettingsRow label="Vault path" sublabel={obsidianVaultPath || 'Not configured'}>
            <div className="cc-settings-inline-actions">
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                onClick={async () => {
                  const folder = await platformApi.server.selectFolder();
                  if (!folder) return;
                  setObsidianVaultPath(folder);
                  await platformApi.server.updateConfig({ obsidianVaultPath: folder });
                  addToast('success', 'Vault path saved. Restarting server...');
                }}
              >
                Browse
              </button>
              {obsidianVaultPath && (
                <button
                  type="button"
                  className="cc-btn cc-btn--danger cc-btn--compact"
                  onClick={async () => {
                    setObsidianVaultPath('');
                    await platformApi.server.updateConfig({ obsidianVaultPath: '' });
                    addToast('success', 'Vault path cleared.');
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </SettingsRow>
          <SettingsRow label="Open in Obsidian" sublabel="Launch Obsidian to view your vault">
            <button
              type="button"
              className="cc-btn cc-btn--secondary cc-btn--compact"
              disabled={!obsidianVaultPath}
              onClick={() => openObsidianVault(obsidianVaultPath)}
            >
              Open
            </button>
          </SettingsRow>
        </SettingsSection>
      )}

      {!isDesktop && (
        <SettingsSection title="Server Connection">
          <SettingsRow label="Server" sublabel={serverUrl ?? 'Unknown'}>
            <span className="cc-settings-status cc-settings-status--success">Connected</span>
          </SettingsRow>
          <SettingsRow label="Logout" sublabel="Disconnect from server">
            <button
              type="button"
              className="cc-btn cc-btn--danger"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Logout
            </button>
          </SettingsRow>
        </SettingsSection>
      )}

      {isDesktop && isHost && token && (
        <SettingsSection title="Connect Mobile Device">
          <PairingCodeDisplay />
        </SettingsSection>
      )}
    </div>
  );
}
