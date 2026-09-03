import { useEffect, useState } from 'react';
import {
  useDeleteProjectHostPath,
  useExecutionHostsQuery,
  useProjectWorkspaceQuery,
  useSetProjectExecutionHost,
  useSetProjectHostPath,
} from '../../hooks/queries';
import { translateUi } from '../../i18n';

/**
 * Where this project's work runs.
 *
 * A path only means something together with the machine holding it, so each
 * machine gets its own, and one of them is the machine the work runs on. Work
 * never moves to another machine on its own — the others are recorded so the
 * project can be moved deliberately, not so it can wander.
 */
export default function ProjectWorkspaceHosts({ projectId }: { projectId: string }) {
  const { data: hosts = [], isLoading: hostsLoading } = useExecutionHostsQuery();
  const { data: workspace } = useProjectWorkspaceQuery(projectId);
  const setPath = useSetProjectHostPath(projectId);
  const setHost = useSetProjectExecutionHost(projectId);
  const removePath = useDeleteProjectHostPath(projectId);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!workspace) return;
    setDrafts(Object.fromEntries(workspace.paths.map((entry) => [entry.host_id, entry.path])));
  }, [workspace]);

  const statusLabel = () => {
    if (!workspace || workspace.is_unconfigured) return translateUi('Not set up');
    if (workspace.is_offline) return translateUi('Offline — work here is refused until it is back');
    return translateUi('Ready');
  };
  const statusTone = () => {
    if (!workspace || workspace.is_unconfigured) return 'muted';
    return workspace.is_offline ? 'warning' : 'success';
  };

  return (
    <section className="cc-project-workspace__section">
      <div className="cc-project-workspace__section-header">
        <div>
          <h2>{translateUi('Where this runs')}</h2>
          <p>
            {translateUi(
              'A path belongs to one machine. Record it per machine, then pick the one this project runs on.',
            )}
          </p>
        </div>
        <span className={`cc-settings-status cc-settings-status--${statusTone()}`}>
          {workspace?.host_label ? `${workspace.host_label} · ` : ''}
          {statusLabel()}
        </span>
      </div>

      {hostsLoading ? (
        <p className="cc-project-workspace__hint">{translateUi('Loading machines…')}</p>
      ) : hosts.length === 0 ? (
        <p className="cc-project-workspace__hint">
          {translateUi(
            'No machines registered yet. Open ClawChat on a machine and turn that machine on in its settings.',
          )}
        </p>
      ) : (
        <div className="cc-project-hosts">
          {hosts.map((host) => {
            const isSelected = workspace?.host_id === host.id;
            const saved = workspace?.paths.find((entry) => entry.host_id === host.id)?.path ?? '';
            const draft = drafts[host.id] ?? '';
            const isDirty = draft.trim() !== saved;
            return (
              <div
                key={host.id}
                className={`cc-project-host${isSelected ? ' cc-project-host--selected' : ''}`}
              >
                <div className="cc-project-host__header">
                  <strong>{host.label}</strong>
                  <span className="cc-project-host__kind">{host.kind}</span>
                  {isSelected && (
                    <span className="cc-project-host__badge">{translateUi('Runs here')}</span>
                  )}
                </div>
                <div className="cc-project-host__row">
                  <input
                    className="cc-settings-input"
                    value={draft}
                    placeholder={translateUi('Path on this machine')}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [host.id]: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="cc-btn cc-btn--compact"
                    disabled={!isDirty || !draft.trim() || setPath.isPending}
                    onClick={() => setPath.mutate({ host_id: host.id, path: draft.trim() })}
                  >
                    {translateUi('Save path')}
                  </button>
                  {saved && !isSelected && (
                    <button
                      type="button"
                      className="cc-btn cc-btn--compact cc-btn--primary"
                      disabled={setHost.isPending}
                      onClick={() => setHost.mutate({ host_id: host.id })}
                    >
                      {translateUi('Run here')}
                    </button>
                  )}
                  {saved && (
                    <button
                      type="button"
                      className="cc-btn cc-btn--ghost cc-btn--compact"
                      disabled={removePath.isPending}
                      onClick={() => removePath.mutate(host.id)}
                    >
                      {translateUi('Forget')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
