import type { ProjectOverviewResponse } from '../../types/api';
import { translateUi } from '../../i18n';

/** The project's configured location, not a running agent's temporary worktree. */
export default function ProjectMachineLine({
  project,
  onChange,
}: {
  project: Pick<
    ProjectOverviewResponse,
    'execution_host_label' | 'execution_host_online' | 'execution_workspace_path'
  >;
  onChange: () => void;
}) {
  const host = project.execution_host_label;
  const online = project.execution_host_online;
  return (
    <div className="cc-project-location">
      <p
        className={`cc-project-workspace__machine cc-project-workspace__machine--${host ? (online ? 'online' : 'offline') : 'unset'}`}
      >
        {host ? (
          <>
            <span className="cc-project-card__host-dot" aria-hidden="true" />
            <span>{translateUi('Runs on {{host}}', { host })}</span>
            <span>
              {online
                ? translateUi('Online')
                : translateUi('Machine offline — runs are refused until it is back')}
            </span>
          </>
        ) : (
          <span>{translateUi('No machine chosen')}</span>
        )}
        <button
          type="button"
          className="cc-btn cc-btn--ghost cc-btn--compact cc-project-workspace__machine-action"
          onClick={onChange}
          aria-label={host ? translateUi('Change where this runs') : undefined}
        >
          {host ? translateUi('Change') : translateUi('Choose machine')}
        </button>
      </p>
      <p className="cc-project-location__path">
        <span>{translateUi('Path on that machine')}</span>
        <code>{project.execution_workspace_path || translateUi('Not set up')}</code>
      </p>
    </div>
  );
}
