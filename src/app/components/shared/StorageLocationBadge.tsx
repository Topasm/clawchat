import { translateUi } from '../../i18n';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { activeWorkspaceName, itemStorageLocation } from '../../utils/workspaceLocation';

interface StorageLocationBadgeProps {
  item: { id: string };
  /**
   * `chip` marks only items still held on this device, so lists stay quiet;
   * `line` always says where the item lives.
   */
  variant?: 'chip' | 'line';
}

export default function StorageLocationBadge({
  item,
  variant = 'chip',
}: StorageLocationBadgeProps) {
  const workspaceName = useWorkspaceStore(activeWorkspaceName);
  const location = itemStorageLocation(item, workspaceName);
  const pendingText = translateUi('Only on this device · waiting to sync to {{workspace}}', {
    workspace: location.workspaceName,
  });

  if (variant === 'chip') {
    if (location.kind !== 'pending') return null;
    return (
      <span
        className="cc-storage-badge cc-storage-badge--pending"
        title={pendingText}
        aria-label={pendingText}
      >
        {translateUi('Waiting to send')}
      </span>
    );
  }

  return (
    <div className={`cc-storage-line cc-storage-line--${location.kind}`} role="note">
      {location.kind === 'pending'
        ? pendingText
        : translateUi('Saved to {{workspace}}', { workspace: location.workspaceName })}
    </div>
  );
}
