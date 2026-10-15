import { Link, useLocation } from 'react-router-dom';
import { translateUi } from '../../i18n';
import { settingsNavigationState } from '../../services/settingsNavigation';
import { useAuthStore } from '../../stores/useAuthStore';
import { useServerHealthStore } from '../../stores/useServerHealthStore';

export const AI_SETTINGS_ROUTE = '/settings/workspace#ai';

/**
 * Without a connected AI provider the server still answers, but briefings
 * and chat fall back to plain text. Say so where that happens instead of
 * leaving the user to wonder why the answers got worse.
 */
export default function AiSetupBanner({ className }: { className?: string }) {
  const location = useLocation();
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const aiConnected = useServerHealthStore((state) =>
    state.serverUrl === serverUrl ? state.health?.aiConnected : undefined,
  );
  if (aiConnected !== false) return null;
  return (
    <div className={`cc-ai-setup-banner${className ? ` ${className}` : ''}`} role="status">
      <span className="cc-ai-setup-banner__text">
        <strong>{translateUi('AI not connected')}</strong>
        {' · '}
        {translateUi('Briefings and chat replies use plain text until an AI provider is set up.')}
      </span>
      <Link
        className="cc-btn cc-btn--secondary cc-btn--compact cc-ai-setup-banner__action"
        to={AI_SETTINGS_ROUTE}
        state={settingsNavigationState(location.pathname, location.search, location.state)}
      >
        {translateUi('Set up')}
      </Link>
    </div>
  );
}
