import { NavLink } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { InboxIcon, NavCalendarIcon, TasksIcon } from './NavIcons';
import { useTodosQuery } from '../../hooks/queries';
import { isInboxTodo } from '../../utils/inboxState';

export const mobileTabs = [
  { to: '/inbox', labelKey: 'nav.inbox', Icon: InboxIcon, primary: true, badge: true },
  { to: '/tasks', labelKey: 'nav.tasks', Icon: TasksIcon, primary: true },
  { to: '/schedule', labelKey: 'nav.schedule', Icon: NavCalendarIcon, primary: true },
];

interface BottomNavProps {
  tabs?: typeof mobileTabs;
}

export default function BottomNav({ tabs = mobileTabs }: BottomNavProps) {
  const { t } = useTranslation();
  const { data: todos = [] } = useTodosQuery();
  const inboxCount = todos.filter(isInboxTodo).length;

  return (
    <nav className="cc-bottom-nav">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `cc-bottom-nav__item${isActive ? ' cc-bottom-nav__item--active' : ''}${tab.primary ? ' cc-bottom-nav__item--primary' : ''}`
          }
        >
          <span className="cc-bottom-nav__icon-wrap">
            <tab.Icon />
            {tab.badge && inboxCount > 0 && (
              <span className="cc-bottom-nav__badge">{inboxCount > 99 ? '99+' : inboxCount}</span>
            )}
          </span>
          <span>{t(tab.labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
