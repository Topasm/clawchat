import { NavLink } from 'react-router-dom';
import { SunIcon, ChatIcon, TasksIcon, InboxIcon, GearIcon } from './NavIcons';
import { useModuleStore } from '../../stores/useModuleStore';

export const mobileTabs = [
  { to: '/today', label: 'Today', Icon: SunIcon, primary: true },
  { to: '/inbox', label: 'Inbox', Icon: InboxIcon, primary: true, badge: true },
  { to: '/chats', label: 'Projects', Icon: ChatIcon, primary: true },
  { to: '/tasks', label: 'Tasks', Icon: TasksIcon, primary: false },
  { to: '/settings', label: 'More', Icon: GearIcon, primary: false },
];

export default function BottomNav() {
  const inboxCount = useModuleStore((s) =>
    (s.todos ?? []).filter((t) => !t.due_date && t.status !== 'completed').length,
  );

  return (
    <nav className="cc-bottom-nav">
      {mobileTabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            `cc-bottom-nav__item${isActive ? ' cc-bottom-nav__item--active' : ''}${t.primary ? ' cc-bottom-nav__item--primary' : ''}`
          }
        >
          <span className="cc-bottom-nav__icon-wrap">
            <t.Icon />
            {t.badge && inboxCount > 0 && (
              <span className="cc-bottom-nav__badge">{inboxCount > 99 ? '99+' : inboxCount}</span>
            )}
          </span>
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
