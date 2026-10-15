import { useEffect, useId, useState, type FormEvent } from 'react';
import { translateUi } from '../../i18n';
import { isValidLocalPin } from '../../services/localServerPin';
import { useWorkspaceRuntimeStore } from '../../stores/useWorkspaceRuntimeStore';
import PairingCodeDisplay from '../pairing/PairingCodeDisplay';
import { SetupStatus, SetupStepActions } from './SetupStepChrome';

/**
 * Step 4 (optional): pair a phone with the existing pairing QR.
 *
 * A phone can only reach this computer's server over the local network. The
 * desktop shell refuses network access while the default PIN 123456 is in
 * use, so turning it on here asks for a new PIN first instead of failing.
 */
export default function PhoneStep({
  signedIn,
  runsLocally,
  paired,
  onPaired,
  onBack,
  onNext,
}: {
  signedIn: boolean;
  runsLocally: boolean;
  paired: boolean;
  onPaired: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const config = useWorkspaceRuntimeStore((state) => state.config);
  const initialize = useWorkspaceRuntimeStore((state) => state.initialize);
  const updateLocalServerPolicy = useWorkspaceRuntimeStore(
    (state) => state.updateLocalServerPolicy,
  );
  const fieldId = useId();
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (runsLocally) void initialize();
  }, [initialize, runsLocally]);

  const lanAccess = config?.lanAccess ?? false;
  const defaultPinInUse = config?.defaultPinInUse ?? true;
  const needsNewPin = defaultPinInUse;
  const networkReady = !runsLocally || (lanAccess && !defaultPinInUse);

  const allowNetwork = async (event: FormEvent) => {
    event.preventDefault();
    if (needsNewPin && !isValidLocalPin(pin)) {
      setError(translateUi('Enter a PIN containing 6 to 32 digits before enabling local access.'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateLocalServerPolicy({ ...(pin ? { pin } : {}), lanAccess: true });
      setPin('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cc-onboarding__card">
      <h2 className="cc-onboarding__card-title">{translateUi('Pair a phone')}</h2>
      <p className="cc-onboarding__card-description">
        {translateUi(
          'Optional. Scan the code with the ClawChat Android app to use the same tasks on your phone. You can do this later from Connections.',
        )}
      </p>

      {!signedIn ? (
        <SetupStatus
          tone="idle"
          label={translateUi('Connect to a server first to pair a phone.')}
        />
      ) : runsLocally && !config ? (
        <SetupStatus tone="busy" label={translateUi('Preparing')} />
      ) : !networkReady ? (
        <form className="cc-onboarding__form" onSubmit={(event) => void allowNetwork(event)}>
          <SetupStatus
            tone="idle"
            label={translateUi('Phones need local network access')}
            detail={translateUi(
              'Off keeps the bundled server on this device only. Turn it on to pair phones or other computers on the same trusted network.',
            )}
          />
          {needsNewPin && (
            <div className="cc-onboarding__input-group">
              <label className="cc-onboarding__input-label" htmlFor={`${fieldId}-pin`}>
                {translateUi('New PIN for this server')}
              </label>
              <input
                id={`${fieldId}-pin`}
                aria-describedby={`${fieldId}-pin-hint`}
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6,32}"
                minLength={6}
                maxLength={32}
                className="cc-onboarding__input"
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value);
                  setError('');
                }}
                autoComplete="new-password"
                aria-invalid={Boolean(error)}
              />
              <span className="cc-onboarding__input-hint" id={`${fieldId}-pin-hint`}>
                {translateUi(
                  'The default PIN 123456 cannot be used on the network. Choose 6 to 32 digits; other computers sign in with it.',
                )}
              </span>
            </div>
          )}
          {saving && (
            <SetupStatus tone="busy" label={translateUi('Restarting the local server…')} />
          )}
          {error && <SetupStatus tone="fail" label={error} />}
          <button
            type="submit"
            className="cc-btn cc-btn--secondary"
            disabled={saving || (needsNewPin && !isValidLocalPin(pin))}
          >
            {lanAccess ? translateUi('Save PIN') : translateUi('Allow local network access')}
          </button>
        </form>
      ) : (
        <>
          <PairingCodeDisplay compact onPaired={onPaired} />
          {paired && <SetupStatus tone="pass" label={translateUi('Phone paired')} />}
        </>
      )}

      <SetupStepActions
        onBack={onBack}
        onNext={onNext}
        onSkipStep={paired ? undefined : onNext}
        nextDisabled={!paired}
      />
    </div>
  );
}
