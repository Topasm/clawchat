import {
  dismissAppUpdate,
  downloadAppUpdate,
  installAppUpdate,
  retryAppUpdate,
} from '../../services/updateLifecycle';
import { useUpdateStore } from '../../stores/useUpdateStore';
import { IS_DESKTOP } from '../../types/platform';
import { CloseIcon } from './Icons';
import { translateUi } from '../../i18n';
function formatBytes(bytes?: number) {
  if (!bytes) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
/** App-wide status and controls for the signed desktop updater. */
export default function UpdateNotification() {
  const status = useUpdateStore((state) => state.status);
  const info = useUpdateStore((state) => state.info);
  const progress = useUpdateStore((state) => state.progress);
  const error = useUpdateStore((state) => state.error);
  if (!IS_DESKTOP || status === 'idle') return null;
  const percent =
    progress?.percent == null ? null : Math.max(0, Math.min(100, Math.round(progress.percent)));
  const canDismiss = status === 'available' || status === 'up-to-date' || status === 'error';
  const releaseNotes = info?.releaseNotes?.trim().slice(0, 240);
  return (
    <div
      className={`cc-update-banner cc-update-banner--${status}`}
      role={status === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="cc-update-banner__content">
        {status === 'checking' && <span>{translateUi('Checking for updates\u2026')}</span>}
        {status === 'up-to-date' && <span>{translateUi('ClawChat is up to date.')}</span>}
        {status === 'available' && (
          <div className="cc-update-banner__message">
            <span>
              {translateUi('ClawChat v')}
              {info?.version}
              {translateUi(' is available.')}
            </span>
            {releaseNotes && (
              <span className="cc-update-banner__notes" title={releaseNotes}>
                {releaseNotes}
              </span>
            )}
          </div>
        )}
        {status === 'downloading' && (
          <div className="cc-update-banner__download">
            <span>
              {translateUi('\n              Downloading update')}
              {percent == null ? '…' : `… ${percent}%`}
              {progress?.totalBytes
                ? ` (${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)})`
                : ''}
            </span>
            <div
              className={`cc-update-banner__progress${percent == null ? ' cc-update-banner__progress--indeterminate' : ''}`}
              role="progressbar"
              aria-label={translateUi('Update download progress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
            >
              <span style={{ width: percent == null ? '18%' : `${percent}%` }} />
            </div>
          </div>
        )}
        {status === 'ready' && (
          <span>{translateUi('Update ready \u2014 restart to apply it.')}</span>
        )}
        {status === 'restarting' && (
          <span>{translateUi('Installing update and restarting\u2026')}</span>
        )}
        {status === 'error' && (
          <div className="cc-update-banner__message">
            <span>{translateUi('Update failed.')}</span>
            <span className="cc-update-banner__notes" title={error ?? undefined}>
              {error}
            </span>
          </div>
        )}
      </div>

      <div className="cc-update-banner__actions">
        {status === 'available' && (
          <button
            type="button"
            className="cc-update-banner__btn"
            onClick={() => void downloadAppUpdate()}
          >
            {translateUi('\n            Download\n          ')}
          </button>
        )}
        {status === 'ready' && (
          <button
            type="button"
            className="cc-update-banner__btn"
            onClick={() => void installAppUpdate()}
          >
            {translateUi('\n            Restart Now\n          ')}
          </button>
        )}
        {status === 'error' && (
          <button
            type="button"
            className="cc-update-banner__btn"
            onClick={() => void retryAppUpdate()}
          >
            {translateUi('\n            Retry\n          ')}
          </button>
        )}
        {canDismiss && (
          <button
            type="button"
            className="cc-update-banner__dismiss"
            aria-label={translateUi('Dismiss update notification')}
            onClick={dismissAppUpdate}
          >
            <CloseIcon size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
