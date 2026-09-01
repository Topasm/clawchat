import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PairingCodeDisplay from '../components/pairing/PairingCodeDisplay';
import SettingsShell from '../components/settings/SettingsShell';
import CalendarSubscriptionCard from '../components/shared/CalendarSubscriptionCard';
import ObsidianStatusCard from '../components/shared/ObsidianStatusCard';
import SegmentedControl from '../components/shared/SegmentedControl';
import SettingsRow from '../components/shared/SettingsRow';
import SettingsSection from '../components/shared/SettingsSection';
import { StatusDot } from '../components/shared/WorkspacePrimitives';
import useSettingsExportImport from '../hooks/useSettingsExportImport';
import usePlatform from '../hooks/usePlatform';
import { useTranslation, translateUi } from '../i18n';
import { platformApi } from '../platform';
import apiClient from '../services/apiClient';
import { settingsNavigationState } from '../services/settingsNavigation';
import { useAuthStore } from '../stores/useAuthStore';
import { useToastStore } from '../stores/useToastStore';
import { LOCAL_WORKSPACE_ID, useWorkspaceStore } from '../stores/useWorkspaceStore';
import { openObsidianVault } from '../utils/openObsidian';
interface AIProviderState {
  active_provider: string;
  openclaw_connected: boolean;
  claude_code_status: string;
  claude_code_version: string | null;
  codex_cli_status: string;
  codex_cli_version: string | null;
  codex_cli_model: string;
  codex_api_status: string;
  codex_api_configured: boolean;
  codex_api_key_persistent: boolean;
  codex_model: string;
}
const AI_PROVIDER_LABELS: Record<string, string> = {
  openclaw: 'OpenClaw',
  claude_code: 'Claude Code',
  codex_cli: 'Codex CLI',
  codex: 'Codex API',
};
type Translate = (key: string, options?: Record<string, string | number>) => string;
const AI_ERROR_TRANSLATIONS: Record<string, string> = {
  invalid_provider: 'workspaceSettings.ai.errors.invalidProvider',
  claude_not_initialized: 'workspaceSettings.ai.errors.claudeNotInitialized',
  claude_unavailable: 'workspaceSettings.ai.errors.claudeUnavailable',
  codex_cli_not_initialized: 'workspaceSettings.ai.errors.codexCliNotInitialized',
  codex_cli_unavailable: 'workspaceSettings.ai.errors.codexCliUnavailable',
  codex_not_initialized: 'workspaceSettings.ai.errors.codexNotInitialized',
  codex_not_configured: 'workspaceSettings.ai.errors.codexNotConfigured',
  codex_authentication_failed: 'workspaceSettings.ai.errors.codexAuthenticationFailed',
  codex_unavailable: 'workspaceSettings.ai.errors.codexUnavailable',
  codex_key_too_short: 'workspaceSettings.ai.errors.codexKeyTooShort',
  codex_model_unavailable: 'workspaceSettings.ai.errors.codexModelUnavailable',
  codex_key_persist_failed: 'workspaceSettings.ai.errors.codexKeyPersistFailed',
};
function providerStatusLabel(status: string, t: Translate): string {
  switch (status) {
    case 'available':
      return t('workspaceSettings.ai.statusAvailable');
    case 'not_configured':
      return t('workspaceSettings.ai.statusNotConfigured');
    case 'authentication_failed':
      return t('workspaceSettings.ai.statusAuthenticationFailed');
    case 'unavailable':
      return t('workspaceSettings.ai.statusUnavailable');
    case 'not_installed':
      return t('workspaceSettings.ai.claudeNotInstalled');
    case 'not_authenticated':
      return t('workspaceSettings.ai.claudeNotAuthenticated');
    default:
      return status;
  }
}
function codexStatusLabel(provider: AIProviderState, t: Translate): string {
  switch (provider.codex_api_status) {
    case 'available':
      return t('workspaceSettings.ai.codexReady', { model: provider.codex_model });
    case 'not_configured':
      return t('workspaceSettings.ai.codexNotConfigured');
    case 'authentication_failed':
      return t('workspaceSettings.ai.codexAuthenticationFailed');
    case 'unavailable':
      return t('workspaceSettings.ai.codexUnavailable', { model: provider.codex_model });
    default:
      return t('workspaceSettings.ai.status', { status: provider.codex_api_status });
  }
}
function apiErrorMessage(error: unknown, t: Translate, fallbackKey: string): string {
  const response = (
    error as {
      response?: {
        data?: {
          error?: {
            details?: {
              reason?: string;
            };
          };
        };
      };
    }
  )?.response;
  const reason = response?.data?.error?.details?.reason;
  const translationKey = reason ? AI_ERROR_TRANSLATIONS[reason] : undefined;
  return t(translationKey ?? fallbackKey);
}
/** Settings backed by the currently connected workspace server. */
export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDesktop } = usePlatform();
  const token = useAuthStore((state) => state.token);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const logout = useAuthStore((state) => state.logout);
  const addToast = useToastStore((state) => state.addToast);
  const isHost = useWorkspaceStore((state) => state.activeWorkspaceId === LOCAL_WORKSPACE_ID);
  const { fileInputRef, handleExport, onFileSelected } = useSettingsExportImport();
  const [obsidianVaultPath, setObsidianVaultPath] = useState('');
  const [aiProvider, setAiProvider] = useState<AIProviderState | null>(null);
  const [aiProviderLoadFailed, setAiProviderLoadFailed] = useState(false);
  const [aiProviderSwitching, setAiProviderSwitching] = useState(false);
  const [claudeCodeChecking, setClaudeCodeChecking] = useState(false);
  const [codexCliChecking, setCodexCliChecking] = useState(false);
  const [codexChecking, setCodexChecking] = useState(false);
  const [codexConfiguring, setCodexConfiguring] = useState(false);
  const [codexApiKey, setCodexApiKey] = useState('');
  const loadAiProvider = useCallback(async () => {
    setAiProviderLoadFailed(false);
    try {
      const response = await apiClient.get('/admin/ai/provider');
      setAiProvider(response.data);
    } catch {
      setAiProviderLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void loadAiProvider();
  }, [loadAiProvider]);
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
        addToast(
          'success',
          t('workspaceSettings.ai.switchedProvider', {
            provider: AI_PROVIDER_LABELS[provider] ?? provider,
          }),
        );
      } catch (error: unknown) {
        addToast('error', apiErrorMessage(error, t, 'workspaceSettings.ai.failedSwitch'));
      } finally {
        setAiProviderSwitching(false);
      }
    },
    [addToast, t],
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
        t('workspaceSettings.ai.providerCheckResult', {
          provider: 'Claude Code',
          status: providerStatusLabel(response.data.status, t),
          version: response.data.version ? ` (${response.data.version})` : '',
        }),
      );
    } catch {
      addToast('error', t('workspaceSettings.ai.failedClaudeCheck'));
    } finally {
      setClaudeCodeChecking(false);
    }
  }, [addToast, t]);
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
      addToast(
        'success',
        t('workspaceSettings.ai.providerCheckResult', {
          provider: 'Codex API',
          status: providerStatusLabel(response.data.status, t),
          version: '',
        }),
      );
    } catch {
      addToast('error', t('workspaceSettings.ai.failedCodexCheck'));
    } finally {
      setCodexChecking(false);
    }
  }, [addToast, t]);
  const handleRecheckCodexCli = useCallback(async () => {
    setCodexCliChecking(true);
    try {
      const response = await apiClient.post('/admin/ai/codex-cli/check', undefined, {
        queueOfflineMutation: false,
      });
      setAiProvider((previous) =>
        previous
          ? {
              ...previous,
              codex_cli_status: response.data.status,
              codex_cli_version: response.data.version,
              codex_cli_model: response.data.model,
            }
          : previous,
      );
      addToast(
        'success',
        t('workspaceSettings.ai.providerCheckResult', {
          provider: 'Codex CLI',
          status: providerStatusLabel(response.data.status, t),
          version: response.data.version ? ` (${response.data.version})` : '',
        }),
      );
    } catch {
      addToast('error', t('workspaceSettings.ai.failedCodexCliCheck'));
    } finally {
      setCodexCliChecking(false);
    }
  }, [addToast, t]);
  const handleConfigureCodex = useCallback(async () => {
    if (!codexApiKey.trim()) {
      addToast('error', t('workspaceSettings.ai.enterApiKey'));
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
      addToast(
        'success',
        t('workspaceSettings.ai.codexConfigured', { model: response.data.codex_model }),
      );
    } catch (error: unknown) {
      addToast('error', apiErrorMessage(error, t, 'workspaceSettings.ai.failedCodexConfigure'));
    } finally {
      setCodexConfiguring(false);
    }
  }, [addToast, codexApiKey, t]);
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
    <SettingsShell
      activePane="workspace"
      title={t('workspaceSettings.title')}
      description={t('settingsShell.workspaceDescription')}
    >
      <div className="cc-settings-page">
        <SettingsSection title={t('workspaceSettings.sections.ai')}>
          <SettingsRow label={t('workspaceSettings.ai.systemPrompt')}>
            <button
              type="button"
              className="cc-btn cc-btn--secondary cc-btn--compact"
              onClick={() =>
                navigate('/settings/system-prompt', {
                  state: settingsNavigationState(
                    location.pathname,
                    location.search,
                    location.state,
                  ),
                })
              }
            >
              {t('workspaceSettings.actions.edit')}
            </button>
          </SettingsRow>
          {aiProviderLoadFailed && (
            <div className="cc-settings-inline-notice" role="alert">
              <span>{t('settingsShell.providerLoadError')}</span>
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                onClick={() => void loadAiProvider()}
              >
                {t('workspaceSettings.actions.retry')}
              </button>
            </div>
          )}
          {aiProvider && (
            <>
              <SettingsRow
                label={t('workspaceSettings.ai.provider')}
                sublabel={
                  aiProvider.active_provider === 'claude_code'
                    ? t('workspaceSettings.ai.usingClaudeCode')
                    : aiProvider.active_provider === 'codex_cli'
                      ? t('workspaceSettings.ai.usingCodexCli', {
                          model:
                            aiProvider.codex_cli_model || t('workspaceSettings.ai.defaultModel'),
                        })
                      : aiProvider.active_provider === 'codex'
                        ? t('workspaceSettings.ai.usingCodex', { model: aiProvider.codex_model })
                        : t('workspaceSettings.ai.usingOpenClaw')
                }
              >
                <SegmentedControl
                  ariaLabel={t('workspaceSettings.ai.providerAria')}
                  options={[
                    { label: translateUi('OpenClaw'), value: 'openclaw' },
                    { label: translateUi('Claude Code'), value: 'claude_code' },
                    { label: t('workspaceSettings.ai.codexCli'), value: 'codex_cli' },
                    { label: translateUi('Codex'), value: 'codex' },
                  ]}
                  value={aiProvider.active_provider}
                  onChange={(provider) =>
                    !aiProviderSwitching && void handleSwitchProvider(provider)
                  }
                />
              </SettingsRow>
              {aiProvider.active_provider === 'codex' && (
                <>
                  <SettingsRow
                    label={t('workspaceSettings.ai.codexApi')}
                    sublabel={codexStatusLabel(aiProvider, t)}
                  >
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
                        {codexChecking
                          ? t('workspaceSettings.actions.checking')
                          : t('workspaceSettings.actions.recheck')}
                      </button>
                    </div>
                  </SettingsRow>
                  <SettingsRow
                    label={t('workspaceSettings.ai.openaiApiKey')}
                    sublabel={
                      aiProvider.codex_api_configured
                        ? aiProvider.codex_api_key_persistent
                          ? t('workspaceSettings.ai.keyStored')
                          : t('workspaceSettings.ai.keyEnvironment')
                        : aiProvider.codex_api_key_persistent
                          ? t('workspaceSettings.ai.keyWillPersist')
                          : t('workspaceSettings.ai.keySessionOnly')
                    }
                  >
                    <div className="cc-settings-inline-actions">
                      <input
                        className="cc-settings-input cc-settings-api-key-input"
                        type="password"
                        value={codexApiKey}
                        onChange={(event) => setCodexApiKey(event.target.value)}
                        placeholder={
                          aiProvider.codex_api_configured
                            ? t('workspaceSettings.ai.configuredPlaceholder')
                            : 'sk-...'
                        }
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={t('workspaceSettings.ai.apiKeyAria')}
                      />
                      <button
                        type="button"
                        className="cc-btn cc-btn--secondary cc-btn--compact"
                        onClick={() => void handleConfigureCodex()}
                        disabled={codexConfiguring || !codexApiKey.trim()}
                      >
                        {codexConfiguring
                          ? t('workspaceSettings.actions.validating')
                          : t('workspaceSettings.actions.saveUse')}
                      </button>
                    </div>
                  </SettingsRow>
                </>
              )}
              {aiProvider.active_provider === 'codex_cli' && (
                <SettingsRow
                  label={t('workspaceSettings.ai.codexCli')}
                  sublabel={
                    aiProvider.codex_cli_status === 'available'
                      ? t('workspaceSettings.ai.codexCliReady', {
                          version: aiProvider.codex_cli_version
                            ? ` — ${aiProvider.codex_cli_version}`
                            : '',
                        })
                      : aiProvider.codex_cli_status === 'not_installed'
                        ? t('workspaceSettings.ai.codexCliNotInstalled')
                        : aiProvider.codex_cli_status === 'not_authenticated'
                          ? t('workspaceSettings.ai.codexCliNotAuthenticated')
                          : t('workspaceSettings.ai.status', {
                              status: aiProvider.codex_cli_status,
                            })
                  }
                >
                  <div className="cc-settings-inline-actions">
                    <StatusDot
                      className="cc-settings-status-dot"
                      tone={aiProvider.codex_cli_status === 'available' ? 'success' : 'neutral'}
                    />
                    <button
                      type="button"
                      className="cc-btn cc-btn--secondary cc-btn--compact"
                      onClick={() => void handleRecheckCodexCli()}
                      disabled={codexCliChecking}
                    >
                      {codexCliChecking
                        ? t('workspaceSettings.actions.checking')
                        : t('workspaceSettings.actions.recheck')}
                    </button>
                  </div>
                </SettingsRow>
              )}
              {aiProvider.active_provider === 'claude_code' && (
                <SettingsRow
                  label={t('workspaceSettings.ai.claudeCodeCli')}
                  sublabel={
                    aiProvider.claude_code_status === 'available'
                      ? t('workspaceSettings.ai.claudeInstalled', {
                          version: aiProvider.claude_code_version
                            ? ` — ${aiProvider.claude_code_version}`
                            : '',
                        })
                      : aiProvider.claude_code_status === 'not_installed'
                        ? t('workspaceSettings.ai.claudeNotInstalled')
                        : aiProvider.claude_code_status === 'not_authenticated'
                          ? t('workspaceSettings.ai.claudeNotAuthenticated')
                          : t('workspaceSettings.ai.status', {
                              status: aiProvider.claude_code_status,
                            })
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
                      {claudeCodeChecking
                        ? t('workspaceSettings.actions.checking')
                        : t('workspaceSettings.actions.recheck')}
                    </button>
                  </div>
                </SettingsRow>
              )}
            </>
          )}
        </SettingsSection>

        <SettingsSection title={t('workspaceSettings.sections.workspace')}>
          <SettingsRow
            label={t('workspaceSettings.workspace.calendarView')}
            sublabel={t('workspaceSettings.workspace.calendarViewHint')}
          >
            <button
              type="button"
              className="cc-btn cc-btn--secondary cc-btn--compact"
              onClick={() => navigate('/schedule/month')}
            >
              {t('workspaceSettings.actions.open')}
            </button>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t('workspaceSettings.sections.importExport')}>
          <SettingsRow
            label={t('workspaceSettings.importExport.exportAll')}
            sublabel={t('workspaceSettings.importExport.exportHint')}
          >
            <button
              type="button"
              className="cc-btn cc-btn--secondary cc-btn--compact"
              onClick={handleExport}
            >
              {t('workspaceSettings.actions.export')}
            </button>
          </SettingsRow>
          <SettingsRow
            label={t('workspaceSettings.importExport.importData')}
            sublabel={t('workspaceSettings.importExport.importHint')}
          >
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
              {t('workspaceSettings.actions.import')}
            </button>
          </SettingsRow>
        </SettingsSection>

        <CalendarSubscriptionCard />
        <ObsidianStatusCard />

        {isDesktop && isHost && (
          <SettingsSection title={t('workspaceSettings.sections.obsidianDesktop')}>
            <SettingsRow
              label={t('workspaceSettings.obsidianDesktop.vaultPath')}
              sublabel={obsidianVaultPath || t('workspaceSettings.obsidianDesktop.notConfigured')}
            >
              <div className="cc-settings-inline-actions">
                <button
                  type="button"
                  className="cc-btn cc-btn--secondary cc-btn--compact"
                  onClick={async () => {
                    const folder = await platformApi.server.selectFolder();
                    if (!folder) return;
                    setObsidianVaultPath(folder);
                    await platformApi.server.updateConfig({ obsidianVaultPath: folder });
                    addToast('success', t('workspaceSettings.obsidianDesktop.vaultSaved'));
                  }}
                >
                  {t('workspaceSettings.actions.browse')}
                </button>
                {obsidianVaultPath && (
                  <button
                    type="button"
                    className="cc-btn cc-btn--danger cc-btn--compact"
                    onClick={async () => {
                      setObsidianVaultPath('');
                      await platformApi.server.updateConfig({ obsidianVaultPath: '' });
                      addToast('success', t('workspaceSettings.obsidianDesktop.vaultCleared'));
                    }}
                  >
                    {t('workspaceSettings.actions.clear')}
                  </button>
                )}
              </div>
            </SettingsRow>
            <SettingsRow
              label={t('workspaceSettings.obsidianDesktop.openInObsidian')}
              sublabel={t('workspaceSettings.obsidianDesktop.openHint')}
            >
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                disabled={!obsidianVaultPath}
                onClick={() => openObsidianVault(obsidianVaultPath)}
              >
                {t('workspaceSettings.actions.open')}
              </button>
            </SettingsRow>
          </SettingsSection>
        )}

        {!isDesktop && (
          <SettingsSection title={t('workspaceSettings.sections.serverConnection')}>
            <SettingsRow
              label={t('workspaceSettings.serverConnection.server')}
              sublabel={serverUrl ?? t('workspaceSettings.serverConnection.unknown')}
            >
              <span className="cc-settings-status cc-settings-status--success">
                {t('connection.connected')}
              </span>
            </SettingsRow>
            <SettingsRow
              label={t('workspaceSettings.serverConnection.logout')}
              sublabel={t('workspaceSettings.serverConnection.logoutHint')}
            >
              <button
                type="button"
                className="cc-btn cc-btn--danger"
                onClick={() => {
                  void logout();
                  navigate('/login');
                }}
              >
                {t('workspaceSettings.actions.logout')}
              </button>
            </SettingsRow>
          </SettingsSection>
        )}

        {isDesktop && isHost && token && (
          <SettingsSection title={t('workspaceSettings.sections.connectMobile')}>
            <PairingCodeDisplay />
          </SettingsSection>
        )}
      </div>
    </SettingsShell>
  );
}
