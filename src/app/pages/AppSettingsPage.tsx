import SettingsShell from '../components/settings/SettingsShell';
import SettingsRow from '../components/shared/SettingsRow';
import SettingsSection from '../components/shared/SettingsSection';
import SegmentedControl from '../components/shared/SegmentedControl';
import Slider from '../components/shared/Slider';
import Toggle from '../components/shared/Toggle';
import { useTheme } from '../config/ThemeContext';
import usePlatform from '../hooks/usePlatform';
import { changeAppLanguage, getAppLanguage, useTranslation, translateUi } from '../i18n';
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
  const { mode, setMode } = useTheme();
  const { t } = useTranslation();
  const { isDesktop, isMobile } = usePlatform();
  const settings = useSettingsStore();
  const updateStatus = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.info);
  const automaticChecksEnabled = useUpdateStore((state) => state.automaticChecksEnabled);
  return (
    <SettingsShell
      activePane="general"
      title={translateUi('Application Settings')}
      description={t('settingsShell.generalDescription')}
    >
      <div className="cc-settings-page">
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

        <SettingsSection title={translateUi('Display')}>
          <SettingsRow label={translateUi('Font size')}>
            <Slider
              value={settings.fontSize}
              min={12}
              max={22}
              onChange={settings.setFontSize}
              formatValue={(value) => `${value}px`}
            />
          </SettingsRow>
          {!isMobile && (
            <SettingsRow
              label={translateUi('Compact mode')}
              sublabel={translateUi('Reduce spacing in expanded mode')}
            >
              <Toggle checked={settings.compactMode} onChange={settings.setCompactMode} />
            </SettingsRow>
          )}
          {isDesktop && (
            <SettingsRow
              label={translateUi('Simple mode')}
              sublabel={translateUi('Show a compact todo list and quick add in a small window')}
            >
              <Toggle checked={settings.simpleMode} onChange={settings.setSimpleMode} />
            </SettingsRow>
          )}
        </SettingsSection>

        <SettingsSection title={translateUi('Notifications')}>
          <SettingsRow label={translateUi('Notifications enabled')}>
            <Toggle
              checked={settings.notificationsEnabled}
              onChange={settings.setNotificationsEnabled}
            />
          </SettingsRow>
          <SettingsRow label={translateUi('Reminder sound')}>
            <Toggle checked={settings.reminderSound} onChange={settings.setReminderSound} />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={translateUi('Reset')}>
          <SettingsRow label={translateUi('Reset application preferences')}>
            <button
              type="button"
              className="cc-btn cc-btn--danger cc-btn--compact"
              onClick={settings.resetApplicationPreferences}
            >
              {translateUi('\n              Reset\n            ')}
            </button>
          </SettingsRow>
        </SettingsSection>

        {isDesktop && (
          <SettingsSection title={translateUi('Updates')}>
            <SettingsRow
              label={translateUi('Automatic update checks')}
              sublabel={translateUi(
                'Check for signed releases periodically. Installation always requires confirmation.',
              )}
            >
              <Toggle checked={automaticChecksEnabled} onChange={setAutomaticUpdateChecks} />
            </SettingsRow>
            <SettingsRow
              label={translateUi('Software update')}
              sublabel={
                updateStatus === 'available'
                  ? translateUi('Version {{version}} is available', {
                      version: updateInfo?.version ?? '',
                    })
                  : updateStatus === 'downloading'
                    ? translateUi('Downloading update\u2026')
                    : updateStatus === 'ready'
                      ? translateUi('Ready to install and restart')
                      : updateStatus === 'restarting'
                        ? translateUi('Installing update\u2026')
                        : updateStatus === 'up-to-date'
                          ? translateUi('ClawChat is up to date')
                          : updateStatus === 'error'
                            ? translateUi('The last update operation failed')
                            : translateUi('Current version {{version}}', {
                                version: platformApi.runtime.appVersion,
                              })
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
                {updateStatus === 'checking' && translateUi('Checking\u2026')}
                {updateStatus === 'downloading' && translateUi('Downloading\u2026')}
                {updateStatus === 'restarting' && translateUi('Restarting\u2026')}
                {updateStatus === 'available' && translateUi('Download')}
                {updateStatus === 'ready' && translateUi('Restart')}
                {updateStatus === 'error' && translateUi('Retry')}
                {(updateStatus === 'idle' || updateStatus === 'up-to-date') &&
                  translateUi('Check Now')}
              </button>
            </SettingsRow>
          </SettingsSection>
        )}

        <SettingsSection title={translateUi('About')}>
          <SettingsRow
            label={translateUi('ClawChat')}
            sublabel={translateUi('Application version')}
          >
            <span className="cc-settings-status cc-settings-status--muted">
              v{platformApi.runtime.appVersion}
            </span>
          </SettingsRow>
        </SettingsSection>
      </div>
    </SettingsShell>
  );
}
