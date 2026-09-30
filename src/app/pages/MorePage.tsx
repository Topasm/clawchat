import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n';
import {
  AdminIcon,
  AutomationsIcon,
  ChatIcon,
  GearIcon,
  ReviewIcon,
  RunsIcon,
  SearchIcon,
} from '../components/shared/NavIcons';

// Everything the phone's five tabs leave out, in the desktop sidebar's order.
const links = [
  { to: '/projects', labelKey: 'nav.projects', Icon: ChatIcon },
  { to: '/automations', labelKey: 'nav.automations', Icon: AutomationsIcon },
  { to: '/runs', labelKey: 'nav.runs', Icon: RunsIcon },
  { to: '/review', labelKey: 'nav.review', Icon: ReviewIcon },
  { to: '/search', labelKey: 'nav.search', Icon: SearchIcon },
  { to: '/settings/app', labelKey: 'nav.settings', Icon: GearIcon },
  { to: '/admin', labelKey: 'nav.admin', Icon: AdminIcon },
];

export default function MorePage() {
  const { t } = useTranslation();
  return (
    <div className="cc-more-page">
      <header className="cc-page-header">
        <h1 className="cc-page-header__title">{t('nav.more')}</h1>
      </header>
      <nav className="cc-more-page__list">
        {links.map(({ to, labelKey, Icon }) => (
          <Link key={to} to={to} className="cc-more-page__link">
            <Icon />
            <span>{t(labelKey)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
