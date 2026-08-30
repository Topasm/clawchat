import { useNavigate } from 'react-router-dom';
import SettingsRow from '../components/shared/SettingsRow';
import SettingsSection from '../components/shared/SettingsSection';
import SegmentedControl from '../components/shared/SegmentedControl';
import Slider from '../components/shared/Slider';
import Toggle from '../components/shared/Toggle';
import ToastContainer from '../components/shared/ToastContainer';
import { useTheme } from '../config/ThemeContext';
import { themeCssVars } from '../config/themeCssVars';
import usePlatform from '../hooks/usePlatform';
import { changeAppLanguage, getAppLanguage, useTranslation } from '../i18n';
import { platformApi } from '../platform';
import {
  checkForAppUpdate,
  downloadAppUpdate,
  installAppUpdate,
  retryAppUpdate,
  setAutomaticUpdateChecks,
} from '../services/updateLifecycle';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useUpdateStore } from '../stores/useUpdateStore';

export default function AppSettingsPage() {
  const navigate = useNavigate();
  const { colors, mode, setMode } = useTheme();
  const { t } = useTranslation();
  const { isDesktop, isMobile } = usePlatform();
  const settings = useSettingsStore();
  const updateStatus = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.info);
  const automaticChecksEnabled = useUpdateStore((state) => state.automaticChecksEnabled);

  return (
    <div className="cc-public-shell" style={themeCssVars(colors, settings.fontSize)}>
      <header className="cc-public-shell__header">
        <div>
          <div className="cc-public-shell__eyebrow">ClawChat</div>
          <h1>Application Settings</h1>
          <p>These preferences remain available without a workspace server connection.</p>
        </div>
        <div className="cc-settings-inline-actions">
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => navigate('/connections')}
          >
            Connections
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => navigate('/diagnostics')}
          >
            Diagnostics
          </button>
          <button type="button" className="cc-btn cc-btn--secondary" onClick={() => navigate(-1)}>
            Done
          </button>
        </div>
      </header>

      <main className="cc-public-shell__content cc-settings-page">
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
              onChange={(value) => setMode(value as 'light' | 'dark' | 'system')}
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

        <SettingsSection title="Display">
          <SettingsRow label="Font size">
            <Slider
              value={settings.fontSize}
              min={12}
              max={22}
              onChange={settings.setFontSize}
              formatValue={(value) => `${value}px`}
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

        <SettingsSection title="Privacy & Storage">
          <SettingsRow label="Save history">
            <Toggle checked={settings.saveHistory} onChange={settings.setSaveHistory} />
          </SettingsRow>
          <SettingsRow label="Analytics">
            <Toggle checked={settings.analyticsEnabled} onChange={settings.setAnalyticsEnabled} />
          </SettingsRow>
          <SettingsRow label="Reset application preferences">
            <button
              type="button"
              className="cc-btn cc-btn--danger cc-btn--compact"
              onClick={settings.resetApplicationPreferences}
            >
              Reset
            </button>
          </SettingsRow>
        </SettingsSection>

        {isDesktop && (
          <SettingsSection title="Updates">
            <SettingsRow
              label="Automatic update checks"
              sublabel="Check for signed releases periodically. Installation always requires confirmation."
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
      </main>
      <ToastContainer />
    </div>
  );
}
