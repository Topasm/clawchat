import { NavLink } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { InboxIcon, MoreIcon, NavCalendarIcon, ReviewIcon, TasksIcon } from './NavIcons';

export const mobileTabs = [
  { to: '/inbox', labelKey: 'nav.inbox', Icon: InboxIcon },
  { to: '/tasks', labelKey: 'nav.tasks', Icon: TasksIcon },
  { to: '/schedule', labelKey: 'nav.schedule', Icon: NavCalendarIcon },
  // Agents stop here for answers, approvals, and reviews: it cannot hide
  // behind a menu on the phone.
  { to: '/attention', labelKey: 'nav.attention', Icon: ReviewIcon },
  { to: '/more', labelKey: 'nav.more', Icon: MoreIcon },
];

interface BottomNavProps {
  tabs?: typeof mobileTabs;
  /** Counts shown on a tab, keyed by its route. */
  badges?: Record<string, number>;
}

export default function BottomNav({ tabs = mobileTabs, badges = {} }: BottomNavProps) {
  const { t } = useTranslation();

  return (
    <nav className="cc-bottom-nav">
      {tabs.map((tab) => {
        const count = badges[tab.to] ?? 0;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `cc-bottom-nav__item cc-bottom-nav__item--primary${isActive ? ' cc-bottom-nav__item--active' : ''}`
            }
          >
            <span className="cc-bottom-nav__icon-wrap">
              <tab.Icon />
              {count > 0 && (
                <span className="cc-bottom-nav__badge">{count > 99 ? '99+' : count}</span>
              )}
            </span>
            <span>{t(tab.labelKey)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
