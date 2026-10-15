import { translateUi } from '../../i18n';
import { platformApi } from '../../platform';
import { findVersionMismatch } from '../../services/serverVersion';

interface ServerVersionNoticeProps {
  serverVersion: string | null | undefined;
  /** What to call the server in the sentence, e.g. the workspace name. */
  serverName?: string;
  appVersion?: string;
  className?: string;
}

/**
 * The app and its server come from one release. When they drift apart some
 * screens break in ways that look like bugs, so name both versions and say
 * which side to update.
 */
export default function ServerVersionNotice({
  serverVersion,
  serverName,
  appVersion = platformApi.runtime.appVersion,
  className,
}: ServerVersionNoticeProps) {
  const mismatch = findVersionMismatch(appVersion, serverVersion);
  if (!mismatch) return null;
  const server = serverName || translateUi('The server');
  const advice =
    mismatch.older === 'server'
      ? translateUi('Update {{server}} to {{version}} so every feature in this app works.', {
          server,
          version: mismatch.appVersion,
        })
      : mismatch.older === 'app'
        ? translateUi('Update this app to {{version}} to match {{server}}.', {
            server,
            version: mismatch.serverVersion,
          })
        : translateUi('Install the same release on both so they work together.');
  return (
    <div className={`cc-version-notice${className ? ` ${className}` : ''}`} role="status">
      <strong>{translateUi('Update needed')}</strong>
      <span>
        {translateUi('{{server}} runs {{serverVersion}}; this app is {{appVersion}}.', {
          server,
          serverVersion: mismatch.serverVersion,
          appVersion: mismatch.appVersion,
        })}{' '}
        {advice}
      </span>
    </div>
  );
}
