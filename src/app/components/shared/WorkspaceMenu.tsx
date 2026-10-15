import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { translateUi, useTranslation } from '../../i18n';
import type { ConnectionStatus } from '../../stores/useAuthStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { settingsNavigationState } from '../../services/settingsNavigation';
import { StatusDot } from './WorkspacePrimitives';
import { AutomationsIcon, DevicesIcon, GearIcon, SearchIcon } from './NavIcons';
import { CollapseIcon } from './Icons';

interface WorkspaceMenuProps {
  workspaceName: string;
  /** Host and port of the workspace server; null for the private workspace on this device. */
  address: string | null;
  connectionStatus: ConnectionStatus;
  connectionLabel: string;
  /** "AI: model" or "AI: offline"; absent until the server has answered. */
  aiLabel: string | null;
  pendingCount: number;
  collapsed: boolean;
  onOpenSearch: () => void;
}

/**
 * The sidebar's foot: which workspace this is and whether it is reachable,
 * and behind it everything that is not one of the four places -- settings,
 * other devices' folders, automations, search, the compact window.
 */
export default function WorkspaceMenu({
  workspaceName,
  address,
  connectionStatus,
  connectionLabel,
  aiLabel,
  pendingCount,
  collapsed,
  onOpenSearch,
}: WorkspaceMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setSimpleMode = useSettingsStore((state) => state.setSimpleMode);
  const [open, setOpen] = useState(false);
  const addressText = address ?? translateUi('On this device');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (to: string, withReturn = false) => {
    setOpen(false);
    navigate(
      to,
      withReturn
        ? { state: settingsNavigationState(location.pathname, location.search, location.state) }
        : undefined,
    );
  };

  return (
    <div className="cc-workspace-menu" ref={rootRef}>
      {open && (
        <div className="cc-workspace-menu__popover" role="menu">
          <button type="button" role="menuitem" onClick={() => go('/connections', true)}>
            <span className="cc-nav-icon" aria-hidden="true" />
            {translateUi('Switch workspace')}
          </button>
          <button type="button" role="menuitem" onClick={() => go('/settings/app', true)}>
            <GearIcon />
            {t('nav.settings')}
          </button>
          <button type="button" role="menuitem" onClick={() => go('/devices')}>
            <DevicesIcon />
            {t('nav.devices')}
          </button>
          <button type="button" role="menuitem" onClick={() => go('/automations')}>
            <AutomationsIcon />
            {t('nav.automations')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSearch();
            }}
          >
            <SearchIcon />
            {t('nav.search')}
            <kbd className="cc-workspace-menu__shortcut">⌘K</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setSimpleMode(true);
            }}
          >
            <CollapseIcon size={16} className="cc-nav-icon" />
            {translateUi('Switch to simple mode')}
          </button>
        </div>
      )}
      <button
        type="button"
        className={`cc-connection-status cc-connection-status--${connectionStatus}`}
        title={[workspaceName, addressText, connectionLabel, aiLabel].filter(Boolean).join(' · ')}
        aria-label={translateUi('Workspace menu. Current: {{name}}', { name: workspaceName })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <StatusDot className="cc-connection-status__dot" />
        {!collapsed && (
          <span className="cc-sidebar__label">
            <span className="cc-workspace-menu__name">{workspaceName}</span>
            <span className="cc-workspace-menu__address" data-testid="workspace-address">
              {addressText}
            </span>
            <span className="cc-workspace-menu__state">
              {connectionLabel}
              {aiLabel ? ` · ${aiLabel}` : ''}
            </span>
          </span>
        )}
        {pendingCount > 0 && (
          <span
            className="cc-offline-badge"
            title={t('connection.pending', { count: pendingCount })}
          >
            {pendingCount}
          </span>
        )}
      </button>
    </div>
  );
}
