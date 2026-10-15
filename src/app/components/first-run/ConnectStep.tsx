import { useId, useState, type FormEvent } from 'react';
import { translateUi } from '../../i18n';
import { parsePairingQrPayload } from '../../services/pairingClaim';
import {
  activateLocalWorkspace,
  connectPairedWorkspace,
  connectRemoteWorkspace,
} from '../../services/workspaceSessionCoordinator';
import { useHostSessionStore } from '../../stores/useHostSessionStore';
import { normalizeWorkspaceUrl } from '../../stores/useWorkspaceStore';
import { IS_DESKTOP } from '../../types/platform';
import QRScanner from '../shared/QRScanner';
import SegmentedControl from '../shared/SegmentedControl';
import { SetupStatus, SetupStepActions } from './SetupStepChrome';

type Choice = 'local' | 'remote';
type RemoteMethod = 'pin' | 'code';

const PAIRED_DEVICE = IS_DESKTOP
  ? { name: 'Desktop Client', type: 'web' }
  : { name: 'Browser', type: 'web' };

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Step 1: where this app's workspace lives.
 *
 * Both paths go through the workspace session coordinator that Settings →
 * Connections uses, so a session opened here is the same one the rest of
 * the app sees.
 */
export default function ConnectStep({
  connectedTo,
  onNext,
}: {
  /** Name of the workspace this app is signed in to, if any. */
  connectedTo: string | null;
  onNext: () => void;
}) {
  const hostPhase = useHostSessionStore((state) => state.phase);
  const fieldId = useId();
  const [choice, setChoice] = useState<Choice | null>(IS_DESKTOP ? null : 'remote');
  const [method, setMethod] = useState<RemoteMethod>('pin');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showScanner, setShowScanner] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const runLocal = () => {
    setChoice('local');
    void run(activateLocalWorkspace);
  };

  const connectRemote = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (method === 'pin') {
        await connectRemoteWorkspace({ name: '', remoteUrl, pin, selectedProfileId: null });
        setPin('');
        return;
      }
      await connectPairedWorkspace(
        {
          type: 'clawchat_pair',
          server_url: normalizeWorkspaceUrl(remoteUrl),
          code: code.trim(),
        },
        PAIRED_DEVICE,
      );
      setCode('');
    });
  };

  const handleScan = (data: string) => {
    setShowScanner(false);
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      setError(translateUi('Invalid QR code'));
      return;
    }
    const payload = parsePairingQrPayload(parsed);
    if (!payload) {
      setError(translateUi('Invalid QR code'));
      return;
    }
    setRemoteUrl(payload.server_url);
    void run(() => connectPairedWorkspace(payload, PAIRED_DEVICE));
  };

  const localStarting =
    busy && choice === 'local' && (hostPhase === 'starting' || hostPhase === 'connecting');

  return (
    <div className="cc-onboarding__card">
      <h2 className="cc-onboarding__card-title">{translateUi('Where should ClawChat run?')}</h2>
      <p className="cc-onboarding__card-description">
        {translateUi(
          'ClawChat keeps your tasks, AI and notes on a server you control. Run one on this computer, or connect this app to one you already have.',
        )}
      </p>

      {IS_DESKTOP && (
        <div className="cc-onboarding__role-grid">
          <button
            type="button"
            className={`cc-onboarding__role-card${choice === 'local' ? ' cc-onboarding__role-card--selected' : ''}`}
            aria-pressed={choice === 'local'}
            disabled={busy}
            onClick={runLocal}
          >
            <div className="cc-onboarding__role-content">
              <div className="cc-onboarding__role-title">
                {translateUi('Run a server on this machine')}
              </div>
              <p className="cc-onboarding__role-description">
                {translateUi(
                  'Starts the bundled server. Your data stays on this computer, and phones can pair with it later.',
                )}
              </p>
            </div>
          </button>
          <button
            type="button"
            className={`cc-onboarding__role-card${choice === 'remote' ? ' cc-onboarding__role-card--selected' : ''}`}
            aria-pressed={choice === 'remote'}
            disabled={busy}
            onClick={() => {
              setChoice('remote');
              setError('');
            }}
          >
            <div className="cc-onboarding__role-content">
              <div className="cc-onboarding__role-title">
                {translateUi('Connect to another server')}
              </div>
              <p className="cc-onboarding__role-description">
                {translateUi(
                  'Use a ClawChat server running on another computer or at home, with its PIN or a pairing code.',
                )}
              </p>
            </div>
          </button>
        </div>
      )}

      {choice === 'remote' && (
        <form className="cc-onboarding__form" onSubmit={connectRemote}>
          <label className="cc-onboarding__input-group">
            <span className="cc-onboarding__input-label">{translateUi('Server URL')}</span>
            <input
              type="url"
              required
              className="cc-onboarding__input"
              value={remoteUrl}
              onChange={(event) => setRemoteUrl(event.target.value)}
              placeholder={translateUi('https://clawchat.example.com')}
            />
          </label>
          <SegmentedControl
            ariaLabel={translateUi('Sign in with')}
            options={[
              { label: translateUi('PIN'), value: 'pin' },
              { label: translateUi('Pairing code'), value: 'code' },
            ]}
            value={method}
            onChange={(value) => setMethod(value as RemoteMethod)}
          />
          {method === 'pin' ? (
            <label className="cc-onboarding__input-group">
              <span className="cc-onboarding__input-label">{translateUi('PIN')}</span>
              <input
                type="password"
                required
                className="cc-onboarding__input"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                autoComplete="current-password"
              />
            </label>
          ) : (
            <div className="cc-onboarding__input-group">
              <label className="cc-onboarding__input-label" htmlFor={`${fieldId}-code`}>
                {translateUi('Pairing code')}
              </label>
              <input
                id={`${fieldId}-code`}
                aria-describedby={`${fieldId}-code-hint`}
                required
                inputMode="numeric"
                className="cc-onboarding__input"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
              />
              <span className="cc-onboarding__input-hint" id={`${fieldId}-code-hint`}>
                {translateUi(
                  'Open Connections on the other server to show a pairing code, then enter it here.',
                )}
              </span>
            </div>
          )}
          <div className="cc-onboarding__form-actions">
            <button
              type="button"
              className="cc-btn cc-btn--ghost"
              onClick={() => setShowScanner(true)}
            >
              {translateUi('Scan QR Code')}
            </button>
            <button type="submit" className="cc-btn cc-btn--secondary" disabled={busy}>
              {busy ? translateUi('Connecting…') : translateUi('Connect')}
            </button>
          </div>
        </form>
      )}

      {localStarting && (
        <SetupStatus
          tone="busy"
          label={translateUi('Starting the server on this computer…')}
          detail={translateUi('This usually takes a few seconds')}
        />
      )}
      {error && <SetupStatus tone="fail" label={translateUi('Could not connect')} detail={error} />}
      {!busy && !error && connectedTo && (
        <SetupStatus
          tone="pass"
          label={translateUi('Connected to {{name}}', { name: connectedTo })}
        />
      )}

      <SetupStepActions onNext={onNext} nextDisabled={busy || !connectedTo} />
      {showScanner && <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
    </div>
  );
}
