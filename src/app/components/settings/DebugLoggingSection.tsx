import { useSyncExternalStore } from 'react';
import { translateUi } from '../../i18n';
import { platformApi } from '../../platform';
import {
  clearDebugLogs,
  getDebugSnapshot,
  serializeDebugLogs,
  setDebugLogging,
  subscribeDebug,
} from '../../services/debugLogging';
import { useToastStore } from '../../stores/useToastStore';
import SettingsSection from '../shared/SettingsSection';
import SettingsRow from '../shared/SettingsRow';
import Toggle from '../shared/Toggle';

export default function DebugLoggingSection() {
  const { enabled, entries } = useSyncExternalStore(
    subscribeDebug,
    getDebugSnapshot,
    getDebugSnapshot,
  );
  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(serializeDebugLogs(platformApi.runtime));
      useToastStore.getState().addToast('success', translateUi('Diagnostic logs copied'));
    } catch {
      useToastStore.getState().addToast('error', translateUi('Could not copy diagnostic logs'));
    }
  };
  const exportLogs = () => {
    try {
      const url = URL.createObjectURL(
        new Blob([serializeDebugLogs(platformApi.runtime)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `clawchat-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      useToastStore.getState().addToast('error', translateUi('Could not export diagnostic logs'));
    }
  };
  return (
    <div data-debug-controls>
      <SettingsSection title={translateUi('Debug logging')}>
        <SettingsRow
          label={translateUi('Capture diagnostic logs')}
          sublabel={translateUi(
            'Off by default. Starts immediately and resets when the app reloads. Turning off stops capture but keeps the current log until cleared.',
          )}
        >
          <Toggle
            label={translateUi('Capture diagnostic logs')}
            checked={enabled}
            onChange={setDebugLogging}
          />
        </SettingsRow>
        <p>
          {translateUi(
            'Captures API timing, status, button activity and runtime error signals. No message text, request bodies, credentials or full URLs. Latest 500 events stay in memory; nothing is uploaded automatically.',
          )}
        </p>
        <div className="cc-diagnostics-actions">
          <button
            className="cc-btn cc-btn--secondary"
            type="button"
            disabled={!entries.length}
            onClick={() => void copyLogs()}
          >
            {translateUi('Copy diagnostic logs')}
          </button>
          <button
            className="cc-btn cc-btn--secondary"
            type="button"
            disabled={!entries.length}
            onClick={exportLogs}
          >
            {translateUi('Export diagnostic logs')}
          </button>
          <button
            className="cc-btn cc-btn--secondary"
            type="button"
            disabled={!entries.length}
            onClick={clearDebugLogs}
          >
            {translateUi('Clear diagnostic logs')}
          </button>
        </div>
        {(enabled || entries.length > 0) && (
          <>
            <p>{enabled ? translateUi('Live capture is on') : translateUi('Capture stopped')}</p>
            <pre className="cc-debug-log" aria-label={translateUi('Diagnostic log')} tabIndex={0}>
              {entries.length
                ? [...entries]
                    .reverse()
                    .map(
                      (entry) =>
                        `${entry.time} ${entry.event} ${entry.method ?? ''} ${entry.resource ?? ''} ${entry.status ?? ''} ${entry.durationMs == null ? '' : `${entry.durationMs}ms`}`,
                    )
                    .join('\n')
                : translateUi('Reproduce the issue to see new events here.')}
            </pre>
          </>
        )}
        <p>
          {translateUi(
            'Server and native process logs are separate. Use Open log folder below. Review files before sharing.',
          )}
        </p>
      </SettingsSection>
    </div>
  );
}
