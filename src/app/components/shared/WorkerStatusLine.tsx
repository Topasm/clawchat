import { useLocation, useNavigate } from 'react-router-dom';
import usePlatform from '../../hooks/usePlatform';
import { settingsNavigationState } from '../../services/settingsNavigation';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useWorkerStore } from '../../stores/useWorkerStore';
import { translateUi } from '../../i18n';

/** Anchor of the worker section on the Settings page. */
export const THIS_MACHINE_SECTION_ID = 'this-machine';

/**
 * What this machine is doing as a worker, next to the connection status.
 *
 * The Attention badge says what needs the user; this says what the machine
 * under their hands is busy with — the one thing the app knows that no other
 * device can show. Only present where the app can run work at all.
 */
export default function WorkerStatusLine() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDesktop } = usePlatform();
  const workerEnabled = useSettingsStore((state) => state.workerEnabled);
  const workerLabel = useSettingsStore((state) => state.workerLabel);
  const hostId = useWorkerStore((state) => state.hostId);
  const busyRunId = useWorkerStore((state) => state.busyRunId);
  const busyRunTitle = useWorkerStore((state) => state.busyRunTitle);

  const label = workerLabel.trim();
  if (!isDesktop || !workerEnabled || !label) return null;

  const state = busyRunId ? 'busy' : hostId ? 'idle' : 'connecting';
  const stateLabel =
    state === 'busy'
      ? translateUi('Running {{title}}', { title: busyRunTitle || busyRunId || '' })
      : state === 'idle'
        ? translateUi('Idle')
        : translateUi('Connecting…');

  return (
    <button
      type="button"
      className={`cc-connection-status cc-worker-status cc-worker-status--${state}`}
      title={translateUi("Open this machine's settings")}
      onClick={() =>
        navigate(`/settings#${THIS_MACHINE_SECTION_ID}`, {
          state: settingsNavigationState(location.pathname, location.search, location.state),
        })
      }
    >
      <span className="cc-connection-status__dot" aria-hidden="true" />
      <span className="cc-sidebar__label">
        {translateUi('This machine: {{label}}', { label })} · {stateLabel}
      </span>
    </button>
  );
}
