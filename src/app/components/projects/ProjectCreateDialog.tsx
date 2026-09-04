import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useBindProjectWorkspace,
  useCreateProject,
  useExecutionHostsQuery,
  useRegisterWorkerHost,
} from '../../hooks/queries';
import usePlatform from '../../hooks/usePlatform';
import { platformApi } from '../../platform';
import { logger } from '../../services/logger';
import { uploadProjectContext } from '../../services/workerRunner';
import { getWorkerDeviceId } from '../../services/workerIdentity';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useToastStore } from '../../stores/useToastStore';
import Dialog from '../shared/Dialog';
import Toggle from '../shared/Toggle';
import { translateUi } from '../../i18n';

interface ProjectCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** What a machine is called before the user names it. */
function defaultMachineLabel(os: string): string {
  switch (os) {
    case 'macos':
      return translateUi('My Mac');
    case 'windows':
      return translateUi('My Windows PC');
    case 'linux':
      return translateUi('My Linux machine');
    default:
      return translateUi('This machine');
  }
}

/**
 * New project, and where it lives.
 *
 * A folder is only meaningful together with the machine that holds it, so the
 * dialog asks for both at once. On a desktop that is not yet registered as a
 * worker, the machine can be switched on right here instead of a detour
 * through Settings — the same store the settings toggle writes.
 */
export default function ProjectCreateDialog({ open, onOpenChange }: ProjectCreateDialogProps) {
  const navigate = useNavigate();
  const { isDesktop } = usePlatform();
  const { data: hosts = [] } = useExecutionHostsQuery();
  const createProject = useCreateProject();
  const registerHost = useRegisterWorkerHost();
  const bindWorkspace = useBindProjectWorkspace();
  const workerEnabled = useSettingsStore((state) => state.workerEnabled);
  const workerLabel = useSettingsStore((state) => state.workerLabel);
  const setWorkerEnabled = useSettingsStore((state) => state.setWorkerEnabled);
  const setWorkerLabel = useSettingsStore((state) => state.setWorkerLabel);

  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [path, setPath] = useState('');
  const [hostId, setHostId] = useState('');
  const [registerHere, setRegisterHere] = useState(false);
  const [machineLabel, setMachineLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const deviceId = useMemo(getWorkerDeviceId, []);

  // This machine, if it is already known to the server under its worker name.
  const thisMachine = useMemo(() => {
    if (!isDesktop || !workerEnabled) return undefined;
    const label = workerLabel.trim();
    return hosts.find(
      (host) =>
        host.kind === 'worker' &&
        (host.device_id === deviceId || (!host.device_id && host.label === label)),
    );
  }, [deviceId, hosts, isDesktop, workerEnabled, workerLabel]);
  const canRegisterHere = isDesktop && !thisMachine;

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setGoal('');
    setPath('');
    setRegisterHere(false);
    setMachineLabel(workerLabel.trim() || defaultMachineLabel(platformApi.runtime.os));
    // Prefer the machine the user is sitting at; otherwise the server itself.
    setHostId(thisMachine?.id ?? hosts.find((host) => host.kind === 'local')?.id ?? '');
    // Only re-seed when the dialog opens; the lists refreshing must not wipe input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedPath = path.trim();
  const needsMachine = trimmedPath.length > 0 && !registerHere && !hostId;
  const needsLabel = registerHere && !machineLabel.trim();
  const canSubmit = title.trim().length > 0 && !needsMachine && !needsLabel && !submitting;

  const browse = async () => {
    try {
      const folder = await platformApi.server.selectFolder();
      if (folder) setPath(folder);
    } catch (error) {
      logger.warn('Folder picker unavailable', error);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      let targetHostId = hostId;
      if (trimmedPath && registerHere) {
        // Register before creating anything, so a failure leaves no half-bound project.
        const label = machineLabel.trim();
        const host = await registerHost.mutateAsync({
          label,
          device_id: deviceId,
          platform: platformApi.runtime.os,
        });
        setWorkerLabel(label);
        setWorkerEnabled(true);
        targetHostId = host.id;
      }
      const project = await createProject.mutateAsync({
        title: title.trim(),
        goal: goal.trim() || null,
      });
      if (trimmedPath && targetHostId) {
        try {
          await bindWorkspace.mutateAsync({
            projectId: project.id,
            hostId: targetHostId,
            path: trimmedPath,
          });
          if (isDesktop && (registerHere || thisMachine?.id === targetHostId)) {
            try {
              // The worker may have registered before this project existed.
              // Publish the first snapshot now so the first chat/run sees it.
              await uploadProjectContext(targetHostId, project.id, trimmedPath);
            } catch (error) {
              logger.warn('Could not send the initial folder context', error);
            }
          }
        } catch (error) {
          logger.warn('Could not bind the project folder', error);
          useToastStore
            .getState()
            .addToast(
              'error',
              translateUi(
                'Project created, but the folder could not be attached. Set it under "Where this runs".',
              ),
            );
        }
      }
      onOpenChange(false);
      navigate(`/projects/${project.id}`);
    } catch (error) {
      logger.warn('Could not create the project', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={translateUi('New Project')}>
      <form className="cc-project-form" onSubmit={submit}>
        <label className="cc-project-form__field">
          <span>{translateUi('Title')}</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={translateUi('What are you working toward?')}
          />
        </label>
        <label className="cc-project-form__field">
          <span>{translateUi('Goal')}</span>
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={translateUi('Describe the outcome that defines success')}
            rows={3}
          />
        </label>

        <label className="cc-project-form__field">
          <span>{translateUi('Folder on a machine')}</span>
          <div className="cc-project-form__row">
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder={translateUi('Path on that machine')}
            />
            {isDesktop && (
              <button
                type="button"
                className="cc-btn cc-btn--compact"
                onClick={() => void browse()}
              >
                {translateUi('Browse…')}
              </button>
            )}
          </div>
          <p className="cc-project-form__hint">
            {translateUi('Optional. Ready tasks run in this folder on that machine.')}
          </p>
        </label>

        {trimmedPath && (
          <div className="cc-project-form__field">
            <span>{translateUi('Machine')}</span>
            {canRegisterHere && (
              <div className="cc-project-form__toggle">
                <span>{translateUi('Run work on this machine')}</span>
                <Toggle
                  checked={registerHere}
                  onChange={setRegisterHere}
                  label={translateUi('Run work on this machine')}
                />
              </div>
            )}
            {registerHere ? (
              <input
                value={machineLabel}
                onChange={(event) => setMachineLabel(event.target.value)}
                placeholder={translateUi('Name for this machine')}
                aria-label={translateUi('Name for this machine')}
              />
            ) : hosts.length === 0 ? (
              <p className="cc-project-form__hint">
                {translateUi(
                  'No machines registered. Open ClawChat on the machine that holds the folder and turn it on in Settings.',
                )}
              </p>
            ) : (
              <select
                value={hostId}
                onChange={(event) => setHostId(event.target.value)}
                aria-label={translateUi('Machine')}
              >
                <option value="">{translateUi('Pick the machine that holds this folder.')}</option>
                {hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.label}
                    {host.id === thisMachine?.id ? ` (${translateUi('This machine')})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="cc-project-form__actions">
          <button type="button" className="cc-btn" onClick={() => onOpenChange(false)}>
            {translateUi('Cancel')}
          </button>
          <button type="submit" className="cc-btn cc-btn--primary" disabled={!canSubmit}>
            {submitting ? translateUi('Creating…') : translateUi('Create project')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
