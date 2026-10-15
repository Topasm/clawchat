import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { translateUi } from '../../i18n';
import { platformApi } from '../../platform';
import { DATA_SHARING_SECTION_ID } from '../settings/DataSharingSettings';
import { useWorkspaceRuntimeStore } from '../../stores/useWorkspaceRuntimeStore';
import { SetupStatus, SetupStepActions } from './SetupStepChrome';

/**
 * Step 3: the Obsidian vault.
 *
 * A server on this computer reads the vault path from the desktop server
 * config, the same setting as Settings → Obsidian. A remote server reads
 * its own vault; this computer's vault can only be shared through it as a
 * read-only data source, from Settings → "Share this machine's data".
 */
export default function ObsidianStep({
  runsLocally,
  serverName,
  onBack,
  onNext,
}: {
  /** The workspace is this computer's own server. */
  runsLocally: boolean;
  serverName: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const navigate = useNavigate();
  const config = useWorkspaceRuntimeStore((state) => state.config);
  const initialize = useWorkspaceRuntimeStore((state) => state.initialize);
  const updateLocalServerPolicy = useWorkspaceRuntimeStore(
    (state) => state.updateLocalServerPolicy,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (runsLocally) void initialize();
  }, [initialize, runsLocally]);

  const vaultPath = config?.obsidianVaultPath ?? '';

  const saveVault = async (obsidianVaultPath: string) => {
    setSaving(true);
    setError('');
    try {
      // The server reads the vault at startup, so this restarts it.
      await updateLocalServerPolicy({ obsidianVaultPath });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const chooseVault = async () => {
    setError('');
    let folder: string | null;
    try {
      folder = await platformApi.server.selectFolder();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    if (folder) await saveVault(folder);
  };

  const server = serverName ?? translateUi('The server');
  const openDataSharing = () =>
    navigate(`/settings/workspace#${DATA_SHARING_SECTION_ID}`, {
      // Settings' Done button comes back to this step rather than step one.
      state: { settingsReturnTo: '/onboarding?step=obsidian' },
    });

  return (
    <div className="cc-onboarding__card">
      <h2 className="cc-onboarding__card-title">{translateUi('Connect your Obsidian vault')}</h2>

      {runsLocally ? (
        <>
          <p className="cc-onboarding__card-description">
            {translateUi(
              'Pick the folder of your Obsidian vault. ClawChat searches your notes and can save results there. You can skip this if you do not use Obsidian.',
            )}
          </p>
          {saving ? (
            <SetupStatus tone="busy" label={translateUi('Restarting the local server…')} />
          ) : vaultPath ? (
            <SetupStatus tone="pass" label={translateUi('Vault connected')} detail={vaultPath} />
          ) : (
            <SetupStatus tone="idle" label={translateUi('No vault selected')} />
          )}
          {error && (
            <SetupStatus
              tone="fail"
              label={translateUi('Could not save the vault')}
              detail={error}
            />
          )}
          <div className="cc-onboarding__form-actions">
            {vaultPath && (
              <button
                type="button"
                className="cc-btn cc-btn--ghost"
                disabled={saving}
                onClick={() => void saveVault('')}
              >
                {translateUi('Clear')}
              </button>
            )}
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              disabled={saving || !config}
              onClick={() => void chooseVault()}
            >
              {vaultPath
                ? translateUi('Choose another folder')
                : translateUi('Choose vault folder')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="cc-onboarding__card-description">
            {translateUi('{{server}} uses the vault configured on that server.', { server })}
          </p>
          {platformApi.worker && (
            <>
              <p className="cc-onboarding__card-description">
                {translateUi(
                  'You can also share the vault on this computer through {{server}}, so your phone and other devices can open and search it. Notes stay on this computer and can be read only while this app is open.',
                  { server },
                )}
              </p>
              <div className="cc-onboarding__form-actions">
                <button
                  type="button"
                  className="cc-btn cc-btn--secondary"
                  onClick={openDataSharing}
                >
                  {translateUi("Share this computer's vault")}
                </button>
              </div>
            </>
          )}
        </>
      )}

      <SetupStepActions
        onBack={onBack}
        onNext={onNext}
        nextDisabled={saving || (runsLocally && !vaultPath)}
        onSkipStep={runsLocally && !vaultPath ? onNext : undefined}
      />
    </div>
  );
}
