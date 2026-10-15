import { translateUi } from '../../i18n';
import type { ConnectionStatus } from '../../stores/useAuthStore';
import type { ServerHealthSnapshot } from '../../stores/useServerHealthStore';
import { StatusDot } from './WorkspacePrimitives';

interface WorkspaceStatusHeaderProps {
  name: string;
  /** Host and port of the workspace server; null for the private workspace on this device. */
  address: string | null;
  connectionStatus: ConnectionStatus;
  connectionLabel: string;
  pendingCount: number;
  pendingLabel: string;
  health: ServerHealthSnapshot | null;
  aiOfflineLabel: string;
  onClick: () => void;
}

/**
 * Which workspace this window shows, where it lives, and whether it is
 * reachable -- kept at the top of the sidebar so it is never a guess.
 */
export default function WorkspaceStatusHeader({
  name,
  address,
  connectionStatus,
  connectionLabel,
  pendingCount,
  pendingLabel,
  health,
  aiOfflineLabel,
  onClick,
}: WorkspaceStatusHeaderProps) {
  const addressText = address ?? translateUi('On this device');
  const aiText = health ? (health.aiConnected ? health.aiModel : aiOfflineLabel) : null;
  return (
    <button
      type="button"
      className={`cc-connection-status cc-connection-status--${connectionStatus}`}
      title={[name, addressText, connectionLabel, aiText ? `AI: ${aiText}` : null]
        .filter(Boolean)
        .join(' · ')}
      aria-label={translateUi('Switch workspace. Current: {{name}}', { name })}
      onClick={onClick}
    >
      <StatusDot className="cc-connection-status__dot" />
      <span className="cc-sidebar__label cc-connection-status__body">
        <span className="cc-connection-status__name">
          {name}
          {pendingCount > 0 && (
            <span className="cc-offline-badge" title={pendingLabel}>
              {pendingCount}
            </span>
          )}
        </span>
        <span className="cc-connection-status__address" data-testid="workspace-address">
          {addressText}
        </span>
        <span className="cc-connection-status__state">
          {connectionLabel}
          {aiText && (
            <span className="cc-connection-status__ai">
              {' · '}
              {translateUi('AI: ')}
              {aiText}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
