import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../config/ThemeContext';
import usePlatform from '../hooks/usePlatform';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useToastStore } from '../stores/useToastStore';
import useSettingsExportImport from '../hooks/useSettingsExportImport';
import apiClient from '../services/apiClient';
import { openObsidianVault } from '../utils/openObsidian';
import SettingsSection from '../components/shared/SettingsSection';
import SettingsRow from '../components/shared/SettingsRow';
import Toggle from '../components/shared/Toggle';
import Slider from '../components/shared/Slider';
import SegmentedControl from '../components/shared/SegmentedControl';
import MobileConnectionPanel from '../components/shared/MobileConnectionPanel';

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
  const [obsidianSyncing, setObsidianSyncing] = useState(false);
  const [obsidianResult, setObsidianResult] = useState<string | null>(null);
  const [obsidianVaultPath, setObsidianVaultPath] = useState('');

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

  const handleObsidianSync = async () => {
    setObsidianSyncing(true);
    setObsidianResult(null);
    try {
      const res = await apiClient.post('/obsidian/sync');
      const d = res.data;
      const msg = `Synced: ${d.created ?? 0} created, ${d.updated ?? 0} updated, ${d.synced ?? d.total ?? 0} total`;
      setObsidianResult(msg);
      addToast('success', msg);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Obsidian sync failed';
      setObsidianResult(null);
      addToast('error', message);
    } finally {
      setObsidianSyncing(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="cc-page-header">
        <div className="cc-page-header__title">Settings</div>
      </div>

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

      <SettingsSection title="Obsidian Sync">
        {isElectron && (
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
        )}
        <SettingsRow label="Sync Now" sublabel="Pull tasks from Obsidian vault">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              onClick={handleObsidianSync}
              disabled={obsidianSyncing || (isElectron && !obsidianVaultPath)}
              style={{ fontSize: 12, padding: '4px 10px' }}
            >
              {obsidianSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label="Open in Obsidian" sublabel="Launch Obsidian to your synced vault">
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
        {obsidianResult && (
          <SettingsRow label="">
            <span style={{ fontSize: 12, color: 'var(--cc-success)' }}>{obsidianResult}</span>
          </SettingsRow>
        )}
      </SettingsSection>

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
      {isElectron && (
        <SettingsSection title="Connect Mobile Device">
          <MobileConnectionPanel />
        </SettingsSection>
      )}
      {isElectron && token && (
        <SettingsSection title="Account">
          <SettingsRow label="Server" sublabel={serverUrl ?? 'localhost:8000'}>
            <span style={{ fontSize: 12, color: 'var(--cc-success)' }}>Connected</span>
          </SettingsRow>
          <SettingsRow label="Logout">
            <button className="cc-btn cc-btn--danger" onClick={() => { logout(); navigate('/today'); }} style={{ fontSize: 12, padding: '4px 10px' }}>
              Logout
            </button>
          </SettingsRow>
        </SettingsSection>
      )}
    </div>
  );
}
