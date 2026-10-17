import { NavLink } from 'react-router-dom';
import { useProjectsQuery } from '../../hooks/queries';
import { translateUi, useTranslation } from '../../i18n';
import type { ProjectResponse } from '../../types/api';

/** The sidebar lists this many projects; the rest are a click away. */
const MAX_SIDEBAR_PROJECTS = 8;

export function projectProgress(
  project: Pick<ProjectResponse, 'task_count' | 'completed_task_count'>,
) {
  if (project.task_count <= 0) return 0;
  return Math.round((project.completed_task_count / project.task_count) * 100);
}

/**
 * Projects under the main places, each with a ring of how much is done. The
 * heading opens the full projects page; the list keeps the ones being
 * worked on, newest first.
 */
export default function SidebarProjects({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { data: projects = [] } = useProjectsQuery();
  const current = projects.filter(
    (project) => project.status === 'active' || project.status === 'planned',
  );
  const listed = current.slice(0, MAX_SIDEBAR_PROJECTS);
  const hidden = current.length - listed.length;
  return (
    <div className="cc-sidebar__section" aria-label={t('nav.projects')}>
      <NavLink
        to="/projects"
        end
        className={({ isActive }) =>
          `cc-sidebar__section-title${isActive ? ' cc-sidebar__section-title--active' : ''}`
        }
        title={collapsed ? t('nav.projects') : undefined}
      >
        <span className="cc-sidebar__label">{t('nav.projects')}</span>
      </NavLink>
      {listed.map((project) => {
        const progress = projectProgress(project);
        return (
          <NavLink
            key={project.id}
            to={`/projects/${project.id}`}
            className={({ isActive }) =>
              `cc-nav-item cc-nav-item--project${isActive ? ' cc-nav-item--active' : ''}`
            }
            title={collapsed ? project.title : undefined}
          >
            <span
              className="cc-progress-ring"
              style={{ '--cc-ring': progress } as React.CSSProperties}
              role="img"
              aria-label={translateUi('{{percent}}% done', { percent: progress })}
            />
            <span className="cc-sidebar__label">{project.title}</span>
          </NavLink>
        );
      })}
      {/* Past the cap the rest are still a click away, never silently gone. */}
      {hidden > 0 && !collapsed && (
        <NavLink to="/projects" end className="cc-nav-item cc-nav-item--more">
          <span className="cc-sidebar__label">
            {translateUi('{{count}} more', { count: hidden })}
          </span>
        </NavLink>
      )}
    </div>
  );
}
