import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../config/ThemeContext';
import usePlatform from '../hooks/usePlatform';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useUpdateStore } from '../stores/useUpdateStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useToastStore } from '../stores/useToastStore';
import useSettingsExportImport from '../hooks/useSettingsExportImport';
import { useAppMode } from '../hooks/useAppMode';
import apiClient from '../services/apiClient';
import { openObsidianVault } from '../utils/openObsidian';
import SettingsSection from '../components/shared/SettingsSection';
import SettingsRow from '../components/shared/SettingsRow';
import CalendarSubscriptionCard from '../components/shared/CalendarSubscriptionCard';
import ObsidianStatusCard from '../components/shared/ObsidianStatusCard';
import Toggle from '../components/shared/Toggle';
import Slider from '../components/shared/Slider';
import SegmentedControl from '../components/shared/SegmentedControl';
import PairingCodeDisplay from '../components/pairing/PairingCodeDisplay';
import { IS_CAPACITOR } from '../types/platform';
import { platformApi, type ServerStatus } from '../platform';
import {
  checkForAppUpdate,
  downloadAppUpdate,
  installAppUpdate,
  retryAppUpdate,
  setAutomaticUpdateChecks,
} from '../services/updateLifecycle';
import { changeAppLanguage, getAppLanguage, useTranslation } from '../i18n';

interface AIProviderState {
  active_provider: string;
  openclaw_connected: boolean;
  claude_code_status: string;
  claude_code_version: string | null;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const { isMobile, isDesktop } = usePlatform();
  const settings = useSettingsStore();
  const token = useAuthStore((s) => s.token);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const logout = useAuthStore((s) => s.logout);
  const { fileInputRef, handleExport, onFileSelected } = useSettingsExportImport();
  const addToast = useToastStore((s) => s.addToast);
  const [obsidianVaultPath, setObsidianVaultPath] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [aiProvider, setAiProvider] = useState<AIProviderState | null>(null);
  const [aiProviderSwitching, setAiProviderSwitching] = useState(false);
  const [claudeCodeChecking, setClaudeCodeChecking] = useState(false);
  const { appMode, setAppMode: switchAppMode, isHost } = useAppMode();
  const [hostServerStatus, setHostServerStatus] = useState<ServerStatus | null>(null);
  const [autoStartHost, setAutoStartHost] = useState(false);
  const updateStatus = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.info);
  const automaticChecksEnabled = useUpdateStore((state) => state.automaticChecksEnabled);

  // Load host-mode specific state
  useEffect(() => {
    if (!isDesktop) return;
    platformApi.server.getStatus().then(setHostServerStatus);
    platformApi.server.getConfig().then((cfg) => {
      setAutoStartHost(cfg.autoStartHost);
    });
    const unsub = platformApi.server.onStatusChange(setHostServerStatus);
    return unsub;
  }, [isDesktop]);

  const handleModeSwitch = useCallback(
    async (newMode: string) => {
      if (newMode !== 'client' && newMode !== 'host') return;
      if (newMode === appMode) return;

      if (appMode === 'host' && newMode === 'client') {
        const confirmed = window.confirm(
          'Switching to client mode will stop the local server. Connected devices will be disconnected. Continue?',
        );
        if (!confirmed) return;
      }

      await switchAppMode(newMode);
      addToast(
        'success',
        newMode === 'host' ? 'Host mode enabled. Server starting...' : 'Switched to client mode.',
      );

      if (newMode === 'client') {
        logout();
        navigate('/login');
      }
    },
    [appMode, switchAppMode, addToast, logout, navigate],
  );

  const handleAutoStartToggle = useCallback(
    async (enabled: boolean) => {
      await platformApi.server.updateConfig({ autoStartHost: enabled });
      setAutoStartHost(enabled);
      addToast('success', enabled ? 'Server will start on login.' : 'Auto-start disabled.');
    },
    [addToast],
  );

  useEffect(() => {
    if (IS_CAPACITOR) {
      import('@capacitor/core').then(({ Capacitor, registerPlugin }) => {
        const Biometric = Capacitor.isPluginAvailable('Biometric')
          ? registerPlugin<{
              isAvailable(): Promise<{ available: boolean }>;
            }>('Biometric')
          : undefined;
        if (Biometric) {
          Biometric.isAvailable().then((res) => setBiometricAvailable(res.available));
        }
      });
    }
  }, []);

  const handleBiometricToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        // Verify identity before enabling
        try {
          const { Capacitor, registerPlugin } = await import('@capacitor/core');
          const Biometric = Capacitor.isPluginAvailable('Biometric')
            ? registerPlugin<{
                authenticate(opts: {
                  title: string;
                  subtitle: string;
                }): Promise<{ success: boolean }>;
              }>('Biometric')
            : undefined;
          if (!Biometric) return;
          const result = await Biometric.authenticate({
            title: 'Enable Biometric Lock',
            subtitle: 'Verify your identity to enable',
          });
          if (result.success) {
            settings.setBiometricEnabled(true);
            addToast('success', 'Biometric lock enabled');
          }
        } catch {
          addToast('error', 'Biometric verification failed');
        }
      } else {
        settings.setBiometricEnabled(false);
        addToast('success', 'Biometric lock disabled');
      }
    },
    [settings, addToast],
  );

  // Fetch AI provider status on mount
  useEffect(() => {
    apiClient
      .get('/admin/ai/provider')
      .then((res) => {
        setAiProvider(res.data);
      })
      .catch(() => {});
  }, []);

  const handleSwitchProvider = useCallback(
    async (provider: string) => {
      setAiProviderSwitching(true);
      try {
        const res = await apiClient.post('/admin/ai/provider', { provider });
        setAiProvider(res.data);
        addToast(
          'success',
          `Switched to ${provider === 'claude_code' ? 'Claude Code' : 'OpenClaw'}`,
        );
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'Failed to switch provider';
        addToast('error', msg);
      } finally {
        setAiProviderSwitching(false);
      }
    },
    [addToast],
  );

  const handleRecheckClaudeCode = useCallback(async () => {
    setClaudeCodeChecking(true);
    try {
      const res = await apiClient.post('/admin/ai/claude-code/check');
      setAiProvider((prev) =>
        prev
          ? { ...prev, claude_code_status: res.data.status, claude_code_version: res.data.version }
          : prev,
      );
      addToast(
        'success',
        `Claude Code: ${res.data.status}${res.data.version ? ` (${res.data.version})` : ''}`,
      );
    } catch {
      addToast('error', 'Failed to check Claude Code status');
    } finally {
      setClaudeCodeChecking(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isDesktop) {
      platformApi.server.getConfig().then((cfg) => {
        setObsidianVaultPath(cfg.obsidianVaultPath ?? '');
      });
    } else {
      apiClient
        .get('/obsidian/status')
        .then((res) => {
          setObsidianVaultPath(res.data?.vaultPath ?? '');
        })
        .catch(() => {});
    }
  }, [isDesktop]);

  return (
    <div className="cc-settings-page">
      <div className="cc-page-header">
        <div className="cc-page-header__title">{t('settings.title')}</div>
      </div>

      {isDesktop && appMode && (
        <SettingsSection title="Server Mode">
          <SettingsRow
            label="App mode"
            sublabel={
              isHost
                ? 'Running as host — server is active on this machine'
                : 'Running as client — connected to a remote host'
            }
          >
            <SegmentedControl
              ariaLabel="Application mode"
              options={[
                { label: 'Client', value: 'client' },
                { label: 'Host', value: 'host' },
              ]}
              value={appMode}
              onChange={handleModeSwitch}
            />
          </SettingsRow>

          {isHost && hostServerStatus && (
            <SettingsRow label="Server status" sublabel={`Port ${hostServerStatus.port}`}>
              <span
                className={`cc-settings-status cc-settings-status--${
                  hostServerStatus.state === 'running'
                    ? 'success'
                    : hostServerStatus.state === 'error'
                      ? 'error'
                      : 'muted'
                }`}
              >
                {hostServerStatus.state === 'running' && 'Host Running'}
                {hostServerStatus.state === 'starting' && 'Starting...'}
                {hostServerStatus.state === 'stopped' && 'Stopped'}
                {hostServerStatus.state === 'error' && (hostServerStatus.error || 'Error')}
              </span>
            </SettingsRow>
          )}

          {isHost && (
            <SettingsRow
              label="Start on login"
              sublabel="Automatically start server when you log in to your computer"
            >
              <Toggle checked={autoStartHost} onChange={handleAutoStartToggle} />
            </SettingsRow>
          )}

          {!isHost && (
            <SettingsRow label="Host server" sublabel={serverUrl || 'Not configured'}>
              <span
                className={`cc-settings-status cc-settings-status--${token ? 'success' : 'subtle'}`}
              >
                {token ? 'Connected' : 'Not connected'}
              </span>
            </SettingsRow>
          )}
        </SettingsSection>
      )}

      <SettingsSection title={t('settings.essentials')}>
        <SettingsRow label={t('settings.theme')}>
          <SegmentedControl
            ariaLabel={t('settings.colorTheme')}
            options={[
              { label: t('settings.system'), value: 'system' },
              { label: t('settings.light'), value: 'light' },
              { label: t('settings.dark'), value: 'dark' },
            ]}
            value={mode}
            onChange={(v) => setMode(v as 'light' | 'dark' | 'system')}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.language')} sublabel={t('settings.languageHint')}>
          <SegmentedControl
            ariaLabel={t('settings.language')}
            options={[
              { label: t('settings.english'), value: 'en' },
              { label: t('settings.korean'), value: 'ko' },
            ]}
            value={getAppLanguage()}
            onChange={(language) => void changeAppLanguage(language as 'en' | 'ko')}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.showTimestamps')}>
          <Toggle checked={settings.showTimestamps} onChange={settings.setShowTimestamps} />
        </SettingsRow>
        <SettingsRow label={t('settings.showAvatars')}>
          <Toggle checked={settings.showAvatars} onChange={settings.setShowAvatars} />
        </SettingsRow>
        <SettingsRow label={t('settings.enterSends')} sublabel={t('settings.enterSendsHint')}>
          <Toggle checked={settings.sendOnEnter} onChange={settings.setSendOnEnter} />
        </SettingsRow>
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
                onChange={(v) => !aiProviderSwitching && handleSwitchProvider(v)}
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
                <span
                  className={`cc-settings-status-dot cc-settings-status-dot--${
                    aiProvider.claude_code_status === 'available' ? 'success' : 'muted'
                  }`}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="cc-btn cc-btn--secondary cc-btn--compact"
                  onClick={handleRecheckClaudeCode}
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

      <SettingsSection title="Display">
        <SettingsRow label="Font size">
          <Slider
            value={settings.fontSize}
            min={12}
            max={22}
            onChange={settings.setFontSize}
            formatValue={(v) => `${v}px`}
          />
        </SettingsRow>
        {!isMobile && (
          <SettingsRow label="Compact mode">
            <Toggle checked={settings.compactMode} onChange={settings.setCompactMode} />
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsRow label="Notifications enabled">
          <Toggle
            checked={settings.notificationsEnabled}
            onChange={settings.setNotificationsEnabled}
          />
        </SettingsRow>
        <SettingsRow label="Reminder sound">
          <Toggle checked={settings.reminderSound} onChange={settings.setReminderSound} />
        </SettingsRow>
      </SettingsSection>

      {biometricAvailable && (
        <SettingsSection title="Security">
          <SettingsRow label="Biometric lock" sublabel="Require fingerprint or face to open app">
            <Toggle checked={settings.biometricEnabled} onChange={handleBiometricToggle} />
          </SettingsRow>
        </SettingsSection>
      )}

      <SettingsSection title="Privacy & Storage">
        <SettingsRow label="Save history">
          <Toggle checked={settings.saveHistory} onChange={settings.setSaveHistory} />
        </SettingsRow>
        <SettingsRow label="Analytics">
          <Toggle checked={settings.analyticsEnabled} onChange={settings.setAnalyticsEnabled} />
        </SettingsRow>
        <SettingsRow label="Reset to defaults">
          <button
            type="button"
            className="cc-btn cc-btn--danger cc-btn--compact"
            onClick={settings.resetToDefaults}
          >
            Reset
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
                  if (folder) {
                    setObsidianVaultPath(folder);
                    await platformApi.server.updateConfig({ obsidianVaultPath: folder });
                    addToast('success', 'Vault path saved. Restarting server...');
                  }
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
      {isDesktop && token && (
        <SettingsSection title="Account">
          <SettingsRow label="Server" sublabel={serverUrl ?? 'localhost:8000'}>
            <span className="cc-settings-status cc-settings-status--success">Connected</span>
          </SettingsRow>
          <SettingsRow label="Logout">
            <button
              className="cc-btn cc-btn--danger cc-btn--compact"
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
      {isDesktop && (
        <SettingsSection title="Updates">
          <SettingsRow
            label="Automatic update checks"
            sublabel="Check for signed releases at startup and periodically. Installation always requires confirmation."
          >
            <Toggle checked={automaticChecksEnabled} onChange={setAutomaticUpdateChecks} />
          </SettingsRow>
          <SettingsRow
            label="Software update"
            sublabel={
              updateStatus === 'available'
                ? `Version ${updateInfo?.version ?? ''} is available`
                : updateStatus === 'downloading'
                  ? 'Downloading update…'
                  : updateStatus === 'ready'
                    ? 'Ready to install and restart'
                    : updateStatus === 'restarting'
                      ? 'Installing update…'
                      : updateStatus === 'up-to-date'
                        ? 'ClawChat is up to date'
                        : updateStatus === 'error'
                          ? 'The last update operation failed'
                          : `Current version ${platformApi.runtime.appVersion}`
            }
          >
            <button
              type="button"
              className="cc-btn cc-btn--secondary cc-btn--compact"
              disabled={
                updateStatus === 'checking' ||
                updateStatus === 'downloading' ||
                updateStatus === 'restarting'
              }
              onClick={() => {
                if (updateStatus === 'available') void downloadAppUpdate();
                else if (updateStatus === 'ready') void installAppUpdate();
                else if (updateStatus === 'error') void retryAppUpdate();
                else void checkForAppUpdate(true);
              }}
            >
              {updateStatus === 'checking' && 'Checking…'}
              {updateStatus === 'downloading' && 'Downloading…'}
              {updateStatus === 'restarting' && 'Restarting…'}
              {updateStatus === 'available' && 'Download'}
              {updateStatus === 'ready' && 'Restart'}
              {updateStatus === 'error' && 'Retry'}
              {(updateStatus === 'idle' || updateStatus === 'up-to-date') && 'Check Now'}
            </button>
          </SettingsRow>
        </SettingsSection>
      )}
      <SettingsSection title="About">
        <SettingsRow label="ClawChat" sublabel="Application version">
          <span className="cc-settings-status cc-settings-status--muted">
            v{platformApi.runtime.appVersion}
          </span>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
