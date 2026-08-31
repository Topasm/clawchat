import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../../config/ThemeContext';
import { themeCssVars } from '../../config/themeCssVars';
import { useTranslation } from '../../i18n';
import { isWorkspaceSessionReady } from '../../services/nativeRoutePolicy';
import { readSettingsReturnTo, settingsNavigationState } from '../../services/settingsNavigation';
import { useAuthStore } from '../../stores/useAuthStore';
import { useHostSessionStore } from '../../stores/useHostSessionStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import ToastContainer from '../shared/ToastContainer';

type SettingsPane = 'general' | 'workspace' | 'connections' | 'diagnostics';

interface SettingsShellProps {
  activePane: SettingsPane;
  title: string;
  description?: string;
  children: ReactNode;
}

const panes: Array<{
  id: SettingsPane;
  path: string;
  labelKey: string;
  hintKey: string;
  requiresWorkspace?: boolean;
}> = [
  {
    id: 'general',
    path: '/settings/app',
    labelKey: 'settingsShell.general',
    hintKey: 'settingsShell.generalHint',
  },
  {
    id: 'workspace',
    path: '/settings/workspace',
    labelKey: 'settingsShell.workspace',
    hintKey: 'settingsShell.workspaceHint',
    requiresWorkspace: true,
  },
  {
    id: 'connections',
    path: '/connections',
    labelKey: 'settingsShell.connections',
    hintKey: 'settingsShell.connectionsHint',
  },
  {
    id: 'diagnostics',
    path: '/diagnostics',
    labelKey: 'settingsShell.diagnostics',
    hintKey: 'settingsShell.diagnosticsHint',
  },
];

export default function SettingsShell({
  activePane,
  title,
  description,
  children,
}: SettingsShellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { colors } = useTheme();
  const fontSize = useSettingsStore((state) => state.fontSize);
  const token = useAuthStore((state) => state.token);
  const healthOK = useAuthStore((state) => state.healthOK);
  const hostPhase = useHostSessionStore((state) => state.phase);
  const workspaceReady = isWorkspaceSessionReady({ token, healthOK, hostPhase });
  const navigationState = settingsNavigationState(
    location.pathname,
    location.search,
    location.state,
  );
  const returnTo = readSettingsReturnTo(location.state);
  const returnToNeedsWorkspace = returnTo === '/login' || returnTo === '/onboarding';
  const closeTarget =
    returnTo && !(workspaceReady && returnToNeedsWorkspace)
      ? returnTo
      : workspaceReady
        ? '/today'
        : '/login';

  return (
    <div className="cc-settings-shell" style={themeCssVars(colors, fontSize)}>
      <header className="cc-settings-shell__header">
        <div>
          <div className="cc-settings-shell__eyebrow">{t('common.appName')}</div>
          <h1>{t('settingsShell.title')}</h1>
        </div>
        <button
          type="button"
          className="cc-btn cc-btn--secondary cc-btn--compact"
          onClick={() => navigate(closeTarget, { replace: true })}
        >
          {t('settingsShell.done')}
        </button>
      </header>

      <div className="cc-settings-shell__layout">
        <nav className="cc-settings-shell__nav" aria-label={t('settingsShell.navigation')}>
          {panes.map((pane) => {
            const unavailable = Boolean(pane.requiresWorkspace && !workspaceReady);
            return (
              <button
                key={pane.id}
                type="button"
                className={`cc-settings-shell__nav-item${activePane === pane.id ? ' cc-settings-shell__nav-item--active' : ''}`}
                aria-current={activePane === pane.id ? 'page' : undefined}
                onClick={() =>
                  navigate(unavailable ? '/connections' : pane.path, { state: navigationState })
                }
              >
                <span>{t(pane.labelKey)}</span>
                <small>
                  {unavailable ? t('settingsShell.workspaceUnavailable') : t(pane.hintKey)}
                </small>
              </button>
            );
          })}
        </nav>

        <main className="cc-settings-shell__content">
          <div className="cc-settings-shell__pane-header">
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {children}
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
