import { NavLink } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { SunIcon, ChatIcon, InboxIcon } from './NavIcons';
import { useTodosQuery } from '../../hooks/queries';

export const mobileTabs = [
  { to: '/today', labelKey: 'nav.today', Icon: SunIcon, primary: true },
  { to: '/inbox', labelKey: 'nav.inbox', Icon: InboxIcon, primary: true, badge: true },
  { to: '/chats', labelKey: 'nav.projects', Icon: ChatIcon, primary: true },
];

export default function BottomNav() {
  const { t } = useTranslation();
  const { data: todos = [] } = useTodosQuery();
  const inboxCount = todos.filter((todo) => !todo.due_date && todo.status !== 'completed').length;

  return (
    <nav className="cc-bottom-nav">
      {mobileTabs.map((tab) => (
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
