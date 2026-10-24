import { Link } from 'react-router-dom';
import { translateUi } from '../../i18n';
import { platformApi } from '../../platform';
import { findVersionMismatch } from '../../services/serverVersion';

interface ServerVersionNoticeProps {
  serverVersion: string | null | undefined;
  /** The workspace the Home server belongs to, named after "the Home server". */
  serverName?: string;
  appVersion?: string;
  className?: string;
  /** Offers the way to the connection settings (the shell banner). */
  showLink?: boolean;
}

/**
 * The app and its server come from one release. When they drift apart some
 * screens break in ways that look like bugs, so say which side is which --
 * "this app" and "the Home server" -- with both versions and which to update.
 */
export default function ServerVersionNotice({
  serverVersion,
  serverName,
  appVersion = platformApi.runtime.appVersion,
  className,
  showLink = false,
}: ServerVersionNoticeProps) {
  const mismatch = findVersionMismatch(appVersion, serverVersion);
  if (!mismatch) return null;
  const server = serverName
    ? translateUi('the Home server ({{workspace}})', { workspace: serverName })
    : translateUi('the Home server');
  const advice =
    mismatch.older === 'server'
      ? translateUi('Update the Home server to {{version}} so every feature in this app works.', {
          version: mismatch.appVersion,
        })
      : mismatch.older === 'app'
        ? translateUi('Update this app to {{version}} to match the Home server.', {
            version: mismatch.serverVersion,
          })
        : translateUi('Install the same release on both so they work together.');
  return (
    <div className={`cc-version-notice${className ? ` ${className}` : ''}`} role="status">
      <strong>{translateUi('Update needed')}</strong>
      <span>
        {translateUi('This app is {{appVersion}}; {{server}} runs {{serverVersion}}.', {
          server,
          serverVersion: mismatch.serverVersion,
          appVersion: mismatch.appVersion,
        })}{' '}
        {advice}
      </span>
      {showLink && (
        <Link className="cc-version-notice__link" to="/connections">
          {translateUi('Connection')}
        </Link>
      )}
    </div>
  );
}
