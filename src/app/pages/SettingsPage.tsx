import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import SettingsShell from '../components/settings/SettingsShell';
import SystemPromptSection from '../components/settings/SystemPromptSection';
import AIModelSettings from '../components/settings/AIModelSettings';
import AgentToolsSettings from '../components/settings/AgentToolsSettings';
import CalendarSyncSettings from '../components/settings/CalendarSyncSettings';
import DataSharingSettings from '../components/settings/DataSharingSettings';
import ScheduleSettings from '../components/settings/ScheduleSettings';
import CalendarSubscriptionCard from '../components/shared/CalendarSubscriptionCard';
import ObsidianStatusCard from '../components/shared/ObsidianStatusCard';
import SegmentedControl from '../components/shared/SegmentedControl';
import SettingsRow from '../components/shared/SettingsRow';
import SettingsSection from '../components/shared/SettingsSection';
import { THIS_MACHINE_SECTION_ID } from '../components/shared/WorkerStatusLine';
import Toggle from '../components/shared/Toggle';
import { StatusDot } from '../components/shared/WorkspacePrimitives';
import { useExecutionHostsQuery } from '../hooks/queries';
import useSettingsExportImport from '../hooks/useSettingsExportImport';
import usePlatform from '../hooks/usePlatform';
import { useTranslation, translateUi } from '../i18n';
import { platformApi } from '../platform';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../stores/useAuthStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useToastStore } from '../stores/useToastStore';
import { LOCAL_WORKSPACE_ID, useWorkspaceStore } from '../stores/useWorkspaceStore';
import { openObsidianVault } from '../utils/openObsidian';
import {
  AI_PROVIDER_LABELS,
  aiProviderErrorMessage,
  codexStatusLabel,
  providerStatusLabel,
  type AIProviderState,
} from '../components/settings/aiProviderStatus';
/** Settings backed by the currently connected workspace server. */
export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDesktop } = usePlatform();
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const addToast = useToastStore((state) => state.addToast);
  const isHost = useWorkspaceStore((state) => state.activeWorkspaceId === LOCAL_WORKSPACE_ID);
  const workerEnabled = useSettingsStore((state) => state.workerEnabled);
  const setWorkerEnabled = useSettingsStore((state) => state.setWorkerEnabled);
  const workerLabel = useSettingsStore((state) => state.workerLabel);
  const setWorkerLabel = useSettingsStore((state) => state.setWorkerLabel);
  const workerProvider = useSettingsStore((state) => state.workerProvider);
  const setWorkerProvider = useSettingsStore((state) => state.setWorkerProvider);
  const { data: executionHosts = [] } = useExecutionHostsQuery();
  const { fileInputRef, handleExport, onFileSelected } = useSettingsExportImport();
  // The sidebar's machine line lands here by anchor; bring that section up.
  useEffect(() => {
    if (!location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [location.hash]);
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
        addToast('error', aiProviderErrorMessage(error, t, 'workspaceSettings.ai.failedSwitch'));
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
      addToast(
        'error',
        aiProviderErrorMessage(error, t, 'workspaceSettings.ai.failedCodexConfigure'),
      );
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
          <SystemPromptSection />
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
              {['codex', 'codex_cli', 'claude_code'].includes(aiProvider.active_provider) && (
                <AIModelSettings
                  key={`${serverUrl}:${aiProvider.active_provider}`}
                  provider={aiProvider.active_provider}
                  onSaved={() => {
                    void loadAiProvider();
                  }}
                />
              )}
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

        <AgentToolsSettings />

        <ScheduleSettings />

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

        <CalendarSyncSettings />

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

        {isDesktop && (
          <SettingsSection
            id={THIS_MACHINE_SECTION_ID}
            title={t('workspaceSettings.sections.thisMachine')}
          >
            <SettingsRow
              label={t('workspaceSettings.thisMachine.name')}
              sublabel={t('workspaceSettings.thisMachine.nameHint')}
            >
              <input
                className="cc-settings-input"
                type="text"
                value={workerLabel}
                onChange={(event) => setWorkerLabel(event.target.value)}
                placeholder={t('workspaceSettings.thisMachine.namePlaceholder')}
              />
            </SettingsRow>
            <SettingsRow label={t('workspaceSettings.thisMachine.cli')}>
              <SegmentedControl
                ariaLabel={t('workspaceSettings.thisMachine.cli')}
                options={[
                  { label: translateUi('Claude Code'), value: 'claude' },
                  { label: translateUi('Codex'), value: 'codex' },
                ]}
                value={workerProvider}
                onChange={setWorkerProvider}
              />
            </SettingsRow>
            <SettingsRow
              label={t('workspaceSettings.thisMachine.runWork')}
              sublabel={
                workerLabel.trim()
                  ? t('workspaceSettings.thisMachine.runWorkHint')
                  : t('workspaceSettings.thisMachine.nameRequired')
              }
            >
              <Toggle
                checked={workerEnabled && workerLabel.trim().length > 0}
                onChange={setWorkerEnabled}
              />
            </SettingsRow>
          </SettingsSection>
        )}

        {isDesktop && platformApi.worker && <DataSharingSettings />}

        {executionHosts.length > 0 && (
          <SettingsSection title={t('workspaceSettings.sections.machines')}>
            {executionHosts.map((host) => (
              <SettingsRow
                key={host.id}
                label={host.label}
                sublabel={
                  host.kind === 'local'
                    ? t('workspaceSettings.machines.thisServer')
                    : host.kind === 'worker'
                      ? t('workspaceSettings.machines.desktopApp')
                      : host.target || host.kind
                }
              >
                <StatusDot tone={host.is_enabled ? 'success' : 'neutral'} />
              </SettingsRow>
            ))}
          </SettingsSection>
        )}

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
      </div>
    </SettingsShell>
  );
}
