import { useNavigate } from 'react-router-dom';
import { useTheme } from '../config/ThemeContext';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAuthStore } from '../stores/useAuthStore';
import useSettingsExportImport from '../hooks/useSettingsExportImport';
import SettingsSection from '../components/shared/SettingsSection';
import SettingsRow from '../components/shared/SettingsRow';
import Toggle from '../components/shared/Toggle';
import Slider from '../components/shared/Slider';
import SegmentedControl from '../components/shared/SegmentedControl';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const settings = useSettingsStore();
  const token = useAuthStore((s) => s.token);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const logout = useAuthStore((s) => s.logout);
  const { fileInputRef, handleExport, onFileSelected } = useSettingsExportImport();

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="cc-page-header">
        <div className="cc-page-header__title">Settings</div>
      </div>

      <SettingsSection title="Chat">
        <SettingsRow label="Font size">
          <Slider
            value={settings.fontSize}
            min={12}
            max={22}
            onChange={settings.setFontSize}
            formatValue={(v) => `${v}px`}
          />
        </SettingsRow>
        <SettingsRow label="Send on Enter" sublabel="Use Shift+Enter for newline">
          <Toggle checked={settings.sendOnEnter} onChange={settings.setSendOnEnter} />
        </SettingsRow>
        <SettingsRow label="Show timestamps">
          <Toggle checked={settings.showTimestamps} onChange={settings.setShowTimestamps} />
        </SettingsRow>
        <SettingsRow label="Show avatars">
          <Toggle checked={settings.showAvatars} onChange={settings.setShowAvatars} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="LLM">
        <SettingsRow label="Temperature">
          <Slider
            value={settings.temperature}
            min={0}
            max={2}
            step={0.1}
            onChange={settings.setTemperature}
            formatValue={(v) => v.toFixed(1)}
          />
        </SettingsRow>
        <SettingsRow label="Max tokens">
          <Slider
            value={settings.maxTokens}
            min={256}
            max={8192}
            step={256}
            onChange={settings.setMaxTokens}
            formatValue={(v) => `${v}`}
          />
        </SettingsRow>
        <SettingsRow label="Stream responses">
          <Toggle checked={settings.streamResponses} onChange={settings.setStreamResponses} />
        </SettingsRow>
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

      <SettingsSection title="Appearance">
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
        <SettingsRow label="Compact mode">
          <Toggle checked={settings.compactMode} onChange={settings.setCompactMode} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsRow label="Notifications enabled">
          <Toggle checked={settings.notificationsEnabled} onChange={settings.setNotificationsEnabled} />
        </SettingsRow>
        <SettingsRow label="Reminder sound">
          <Toggle checked={settings.reminderSound} onChange={settings.setReminderSound} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Data & Storage">
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

      <SettingsSection title="Data Management">
        <SettingsRow label="Export all data" sublabel="Download todos, events, memos, and conversations as JSON">
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

      <SettingsSection title="Server Connection">
        {token ? (
          <>
            <SettingsRow label="Server" sublabel={serverUrl ?? 'Unknown'}>
              <span style={{ fontSize: 12, color: 'var(--cc-success)' }}>Connected</span>
            </SettingsRow>
            <SettingsRow label="Logout" sublabel="Disconnect from server">
              <button className="cc-btn cc-btn--danger" onClick={() => { logout(); navigate('/today'); }}>
                Logout
              </button>
            </SettingsRow>
          </>
        ) : (
          <SettingsRow label="Demo Mode" sublabel="No server connected">
            <button className="cc-btn cc-btn--primary" onClick={() => navigate('/login')}>
              Connect
            </button>
          </SettingsRow>
        )}
      </SettingsSection>
    </div>
  );
}
