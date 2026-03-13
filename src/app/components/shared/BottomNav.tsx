import { NavLink } from 'react-router-dom';
import { SunIcon, ChatIcon, TasksIcon, InboxIcon, GearIcon } from './NavIcons';

const tabs = [
  { to: '/today', label: 'Today', Icon: SunIcon },
  { to: '/chats', label: 'Chats', Icon: ChatIcon },
  { to: '/tasks', label: 'Tasks', Icon: TasksIcon },
  { to: '/inbox', label: 'Inbox', Icon: InboxIcon },
  { to: '/settings', label: 'More', Icon: GearIcon },
];

export default function BottomNav() {
  return (
    <nav className="cc-bottom-nav">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            `cc-bottom-nav__item${isActive ? ' cc-bottom-nav__item--active' : ''}`
          }
        >
          <t.Icon />
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
