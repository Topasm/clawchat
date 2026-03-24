import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../config/ThemeContext';
import usePlatform from '../hooks/usePlatform';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useToastStore } from '../stores/useToastStore';
import useSettingsExportImport from '../hooks/useSettingsExportImport';
import { useAppMode } from '../hooks/useAppMode';
import apiClient from '../services/apiClient';
import { openObsidianVault } from '../utils/openObsidian';
import SettingsSection from '../components/shared/SettingsSection';
import SettingsRow from '../components/shared/SettingsRow';
import ObsidianStatusCard from '../components/shared/ObsidianStatusCard';
import Toggle from '../components/shared/Toggle';
import Slider from '../components/shared/Slider';
import SegmentedControl from '../components/shared/SegmentedControl';
import PairingCodeDisplay from '../components/pairing/PairingCodeDisplay';
import { IS_CAPACITOR } from '../types/platform';
import type { ServerStatus } from '../types/electron';

interface AIProviderState {
  active_provider: string;
  openclaw_connected: boolean;
  claude_code_status: string;
  claude_code_version: string | null;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const { isMobile, isElectron } = usePlatform();
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

  // Load host-mode specific state
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI.server.getStatus().then(setHostServerStatus);
    window.electronAPI.server.getConfig().then((cfg) => {
      setAutoStartHost(cfg.autoStartHost);
    });
    const unsub = window.electronAPI.server.onStatusChange(setHostServerStatus);
    return unsub;
  }, [isElectron]);

  const handleModeSwitch = useCallback(async (newMode: string) => {
    if (newMode !== 'client' && newMode !== 'host') return;
    if (newMode === appMode) return;

    if (appMode === 'host' && newMode === 'client') {
      const confirmed = window.confirm(
        'Switching to client mode will stop the local server. Connected devices will be disconnected. Continue?'
      );
      if (!confirmed) return;
    }

    await switchAppMode(newMode);
    addToast('success', newMode === 'host' ? 'Host mode enabled. Server starting...' : 'Switched to client mode.');

    if (newMode === 'client') {
      logout();
      navigate('/login');
    }
  }, [appMode, switchAppMode, addToast, logout, navigate]);

  const handleAutoStartToggle = useCallback(async (enabled: boolean) => {
    await window.electronAPI.server.updateConfig({ autoStartHost: enabled });
    setAutoStartHost(enabled);
    addToast('success', enabled ? 'Server will start on login.' : 'Auto-start disabled.');
  }, [addToast]);

  useEffect(() => {
    if (IS_CAPACITOR) {
      import('@capacitor/core').then(({ Capacitor }) => {
        const Biometric = Capacitor.Plugins['Biometric'] as {
          isAvailable(): Promise<{ available: boolean }>;
        } | undefined;
        if (Biometric) {
          Biometric.isAvailable().then((res) => setBiometricAvailable(res.available));
        }
      });
    }
  }, []);

  const handleBiometricToggle = useCallback(async (enabled: boolean) => {
    if (enabled) {
      // Verify identity before enabling
      try {
        const { Capacitor } = await import('@capacitor/core');
        const Biometric = Capacitor.Plugins['Biometric'] as {
          authenticate(opts: { title: string; subtitle: string }): Promise<{ success: boolean }>;
        } | undefined;
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
  }, [settings, addToast]);

  // Fetch AI provider status on mount
  useEffect(() => {
    apiClient.get('/admin/ai/provider').then((res) => {
      setAiProvider(res.data);
    }).catch(() => {});
  }, []);

  const handleSwitchProvider = useCallback(async (provider: string) => {
    setAiProviderSwitching(true);
    try {
      const res = await apiClient.post('/admin/ai/provider', { provider });
      setAiProvider(res.data);
      addToast('success', `Switched to ${provider === 'claude_code' ? 'Claude Code' : 'OpenClaw'}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to switch provider';
      addToast('error', msg);
    } finally {
      setAiProviderSwitching(false);
    }
  }, [addToast]);

  const handleRecheckClaudeCode = useCallback(async () => {
    setClaudeCodeChecking(true);
    try {
      const res = await apiClient.post('/admin/ai/claude-code/check');
      setAiProvider((prev) => prev ? { ...prev, claude_code_status: res.data.status, claude_code_version: res.data.version } : prev);
      addToast('success', `Claude Code: ${res.data.status}${res.data.version ? ` (${res.data.version})` : ''}`);
    } catch {
      addToast('error', 'Failed to check Claude Code status');
    } finally {
      setClaudeCodeChecking(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isElectron) {
      window.electronAPI.server.getConfig().then((cfg) => {
        setObsidianVaultPath(cfg.obsidianVaultPath ?? '');
      });
    } else {
      apiClient.get('/obsidian/status').then((res) => {
        setObsidianVaultPath(res.data?.vaultPath ?? '');
      }).catch(() => {});
    }
  }, [isElectron]);

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="cc-page-header">
        <div className="cc-page-header__title">Settings</div>
      </div>

      {isElectron && appMode && (
        <SettingsSection title="Server Mode">
          <SettingsRow label="App mode" sublabel={
            isHost
              ? 'Running as host — server is active on this machine'
              : 'Running as client — connected to a remote host'
          }>
            <SegmentedControl
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
              <span style={{
                fontSize: 12,
                color: hostServerStatus.state === 'running'
                  ? 'var(--cc-success)'
                  : hostServerStatus.state === 'error'
                    ? 'var(--cc-error)'
                    : 'var(--cc-text-secondary)',
              }}>
                {hostServerStatus.state === 'running' && 'Host Running'}
                {hostServerStatus.state === 'starting' && 'Starting...'}
                {hostServerStatus.state === 'stopped' && 'Stopped'}
                {hostServerStatus.state === 'error' && (hostServerStatus.error || 'Error')}
              </span>
            </SettingsRow>
          )}

          {isHost && (
            <SettingsRow label="Start on login" sublabel="Automatically start server when you log in to your computer">
              <Toggle checked={autoStartHost} onChange={handleAutoStartToggle} />
            </SettingsRow>
          )}

          {!isHost && (
            <SettingsRow label="Host server" sublabel={serverUrl || 'Not configured'}>
              <span style={{
                fontSize: 12,
                color: token ? 'var(--cc-success)' : 'var(--cc-text-tertiary)',
              }}>
                {token ? 'Connected' : 'Not connected'}
              </span>
            </SettingsRow>
          )}
        </SettingsSection>
      )}

      <SettingsSection title="Essentials">
        <SettingsRow label="Theme">
          <SegmentedControl
            options={[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]}
            value={mode}
            onChange={(v) => setMode(v as 'light' | 'dark' | 'system')}
          />
        </SettingsRow>
        <SettingsRow label="Show timestamps">
          <Toggle checked={settings.showTimestamps} onChange={settings.setShowTimestamps} />
        </SettingsRow>
        <SettingsRow label="Show avatars">
          <Toggle checked={settings.showAvatars} onChange={settings.setShowAvatars} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="AI">
        <SettingsRow label="System prompt">
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => navigate('/settings/system-prompt')}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Edit
          </button>
        </SettingsRow>
        {aiProvider && (
          <>
            <SettingsRow
              label="AI Provider"
              sublabel={aiProvider.active_provider === 'claude_code' ? 'Using Claude Code CLI' : 'Using OpenClaw gateway'}
            >
              <SegmentedControl
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: aiProvider.claude_code_status === 'available' ? 'var(--cc-success)' : 'var(--cc-text-tertiary)',
                  }}
                />
                <button
                  type="button"
                  className="cc-btn cc-btn--secondary"
                  onClick={handleRecheckClaudeCode}
                  disabled={claudeCodeChecking}
                  style={{ fontSize: 12, padding: '4px 10px' }}
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
            className="cc-btn cc-btn--secondary"
            onClick={() => navigate('/calendar')}
            style={{ fontSize: 12, padding: '4px 10px' }}
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
          <Toggle checked={settings.notificationsEnabled} onChange={settings.setNotificationsEnabled} />
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
            className="cc-btn cc-btn--danger"
            onClick={settings.resetToDefaults}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Reset
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Import / Export">
        <SettingsRow label="Export all data" sublabel="Download todos, events, and conversations as JSON">
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={handleExport}
            style={{ fontSize: 12, padding: '4px 10px' }}
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
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => fileInputRef.current?.click()}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Import
          </button>
        </SettingsRow>
      </SettingsSection>

      <ObsidianStatusCard />

      {isElectron && isHost && (
        <SettingsSection title="Obsidian Desktop">
          <SettingsRow label="Vault path" sublabel={obsidianVaultPath || 'Not configured'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="cc-btn cc-btn--secondary"
                onClick={async () => {
                  const folder = await window.electronAPI.server.selectFolder();
                  if (folder) {
                    setObsidianVaultPath(folder);
                    await window.electronAPI.server.updateConfig({ obsidianVaultPath: folder });
                    addToast('success', 'Vault path saved. Restarting server...');
                  }
                }}
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                Browse
              </button>
              {obsidianVaultPath && (
                <button
                  type="button"
                  className="cc-btn cc-btn--danger"
                  onClick={async () => {
                    setObsidianVaultPath('');
                    await window.electronAPI.server.updateConfig({ obsidianVaultPath: '' });
                    addToast('success', 'Vault path cleared.');
                  }}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  Clear
                </button>
              )}
            </div>
          </SettingsRow>
          <SettingsRow label="Open in Obsidian" sublabel="Launch Obsidian to view your vault">
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              disabled={!obsidianVaultPath}
              onClick={() => openObsidianVault(obsidianVaultPath)}
              style={{ fontSize: 12, padding: '4px 10px' }}
            >
              Open
            </button>
          </SettingsRow>
        </SettingsSection>
      )}

      {!isElectron && (
        <SettingsSection title="Server Connection">
          <SettingsRow label="Server" sublabel={serverUrl ?? 'Unknown'}>
            <span style={{ fontSize: 12, color: 'var(--cc-success)' }}>Connected</span>
          </SettingsRow>
          <SettingsRow label="Logout" sublabel="Disconnect from server">
            <button className="cc-btn cc-btn--danger" onClick={() => { logout(); navigate('/login'); }}>
              Logout
            </button>
          </SettingsRow>
        </SettingsSection>
      )}
      {isElectron && isHost && token && (
        <SettingsSection title="Connect Mobile Device">
          <PairingCodeDisplay />
        </SettingsSection>
      )}
      {isElectron && token && (
        <SettingsSection title="Account">
          <SettingsRow label="Server" sublabel={serverUrl ?? 'localhost:8000'}>
            <span style={{ fontSize: 12, color: 'var(--cc-success)' }}>Connected</span>
          </SettingsRow>
          <SettingsRow label="Logout">
            <button className="cc-btn cc-btn--danger" onClick={() => { logout(); navigate('/login'); }} style={{ fontSize: 12, padding: '4px 10px' }}>
              Logout
            </button>
          </SettingsRow>
        </SettingsSection>
      )}
    </div>
  );
}
