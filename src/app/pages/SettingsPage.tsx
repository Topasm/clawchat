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
  codex_api_status: string;
  codex_api_configured: boolean;
  codex_api_key_persistent: boolean;
  codex_model: string;
}

const AI_PROVIDER_LABELS: Record<string, string> = {
  openclaw: 'OpenClaw',
  claude_code: 'Claude Code',
  codex: 'Codex API',
};

function codexStatusLabel(provider: AIProviderState): string {
  switch (provider.codex_api_status) {
    case 'available':
      return `Ready — ${provider.codex_model}`;
    case 'not_configured':
      return 'Not configured — add an OpenAI API key';
    case 'authentication_failed':
      return 'The configured API key was rejected';
    case 'unavailable':
      return `Unavailable — check network and access to ${provider.codex_model}`;
    default:
      return `Status: ${provider.codex_api_status}`;
  }
}

function apiErrorMessage(error: unknown, fallback: string): string {
  const response = (
    error as {
      response?: { data?: { detail?: string; error?: { message?: string } } };
    }
  )?.response;
  return response?.data?.detail ?? response?.data?.error?.message ?? fallback;
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
  const [codexChecking, setCodexChecking] = useState(false);
  const [codexConfiguring, setCodexConfiguring] = useState(false);
  const [codexApiKey, setCodexApiKey] = useState('');

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
        const response = await apiClient.post(
          '/admin/ai/provider',
          { provider },
          { queueOfflineMutation: false },
        );
        setAiProvider(response.data);
        addToast('success', `Switched to ${AI_PROVIDER_LABELS[provider] ?? provider}`);
      } catch (error: unknown) {
        addToast('error', apiErrorMessage(error, 'Failed to switch provider'));
      } finally {
        setAiProviderSwitching(false);
      }
    },
    [addToast],
  );

  const handleRecheckClaudeCode = useCallback(async () => {
    setClaudeCodeChecking(true);
    try {
      const response = await apiClient.post('/admin/ai/claude-code/check', undefined, {
        queueOfflineMutation: false,
      });
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

  const handleRecheckCodex = useCallback(async () => {
    setCodexChecking(true);
    try {
      const response = await apiClient.post('/admin/ai/codex/check', undefined, {
        queueOfflineMutation: false,
      });
      setAiProvider((previous) =>
        previous
          ? {
              ...previous,
              codex_api_status: response.data.status,
              codex_api_configured: response.data.configured,
              codex_model: response.data.model,
            }
          : previous,
      );
      addToast('success', `Codex API: ${response.data.status}`);
    } catch {
      addToast('error', 'Failed to check Codex API status');
    } finally {
      setCodexChecking(false);
    }
  }, [addToast]);

  const handleConfigureCodex = useCallback(async () => {
    if (!codexApiKey.trim()) {
      addToast('error', 'Enter an OpenAI API key');
      return;
    }
    setCodexConfiguring(true);
    try {
      const response = await apiClient.put(
        '/admin/ai/codex',
        { api_key: codexApiKey.trim() },
        { queueOfflineMutation: false },
      );
      setAiProvider(response.data);
      setCodexApiKey('');
      addToast('success', `Codex API is ready with ${response.data.codex_model}`);
    } catch (error: unknown) {
      addToast('error', apiErrorMessage(error, 'Failed to configure Codex API'));
    } finally {
      setCodexConfiguring(false);
    }
  }, [addToast, codexApiKey]);

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
                  : aiProvider.active_provider === 'codex'
                    ? `Using Codex API — ${aiProvider.codex_model}`
                    : 'Using OpenClaw gateway'
              }
            >
              <SegmentedControl
                ariaLabel="AI provider"
                options={[
                  { label: 'OpenClaw', value: 'openclaw' },
                  { label: 'Claude Code', value: 'claude_code' },
                  { label: 'Codex', value: 'codex' },
                ]}
                value={aiProvider.active_provider}
                onChange={(provider) => !aiProviderSwitching && void handleSwitchProvider(provider)}
              />
            </SettingsRow>
            <SettingsRow label="Codex API" sublabel={codexStatusLabel(aiProvider)}>
              <div className="cc-settings-inline-actions">
                <StatusDot
                  className="cc-settings-status-dot"
                  tone={aiProvider.codex_api_status === 'available' ? 'success' : 'neutral'}
                />
                <button
                  type="button"
                  className="cc-btn cc-btn--secondary cc-btn--compact"
                  onClick={() => void handleRecheckCodex()}
                  disabled={codexChecking || !aiProvider.codex_api_configured}
                >
                  {codexChecking ? 'Checking...' : 'Recheck'}
                </button>
              </div>
            </SettingsRow>
            <SettingsRow
              label="OpenAI API key"
              sublabel={
                aiProvider.codex_api_configured
                  ? aiProvider.codex_api_key_persistent
                    ? 'Stored for this workspace; enter a new key only to replace it'
                    : 'Configured by the environment or for the current server session'
                  : aiProvider.codex_api_key_persistent
                    ? 'Validated before it is stored in the local app data folder'
                    : 'Validated for this server session; use CODEX_API_KEY to persist it'
              }
            >
              <div className="cc-settings-inline-actions">
                <input
                  className="cc-settings-input cc-settings-api-key-input"
                  type="password"
                  value={codexApiKey}
                  onChange={(event) => setCodexApiKey(event.target.value)}
                  placeholder={aiProvider.codex_api_configured ? 'Configured' : 'sk-...'}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="OpenAI API key"
                />
                <button
                  type="button"
                  className="cc-btn cc-btn--secondary cc-btn--compact"
                  onClick={() => void handleConfigureCodex()}
                  disabled={codexConfiguring || !codexApiKey.trim()}
                >
                  {codexConfiguring ? 'Validating...' : 'Save & Use'}
                </button>
              </div>
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
