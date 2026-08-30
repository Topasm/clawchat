import { useNavigate } from 'react-router-dom';
import WorkspaceConnectionsSection from '../components/settings/WorkspaceConnectionsSection';
import SettingsRow from '../components/shared/SettingsRow';
import SettingsSection from '../components/shared/SettingsSection';
import SegmentedControl from '../components/shared/SegmentedControl';
import ToastContainer from '../components/shared/ToastContainer';
import { useTheme } from '../config/ThemeContext';
import { changeAppLanguage, getAppLanguage, useTranslation } from '../i18n';
import { themeCssVars } from '../config/themeCssVars';

export default function ConnectionCenterPage() {
  const navigate = useNavigate();
  const { colors, mode, setMode } = useTheme();
  const { t } = useTranslation();

  return (
    <div className="cc-public-shell" style={themeCssVars(colors)}>
      <header className="cc-public-shell__header">
        <div>
          <div className="cc-public-shell__eyebrow">ClawChat</div>
          <h1>Connections</h1>
          <p>Choose the workspace to view and manage this device's local server separately.</p>
        </div>
        <div className="cc-settings-inline-actions">
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => navigate('/diagnostics')}
          >
            Diagnostics
          </button>
          <button type="button" className="cc-btn cc-btn--secondary" onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
      </header>

      <main className="cc-public-shell__content cc-settings-page">
        <WorkspaceConnectionsSection />

        <SettingsSection title="Application">
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
        </SettingsSection>
      </main>
      <ToastContainer />
    </div>
  );
}
