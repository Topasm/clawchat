import { translateUi } from '../../i18n';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { activeWorkspace, itemStorageLocation } from '../../utils/workspaceLocation';

interface StorageLocationBadgeProps {
  item: { id: string };
  /**
   * `chip` marks only items still held on this device, so lists stay quiet;
   * `line` always says where the item lives: on this device, or on which
   * Home server.
   */
  variant?: 'chip' | 'line';
}

export default function StorageLocationBadge({
  item,
  variant = 'chip',
}: StorageLocationBadgeProps) {
  // Two primitive selections, so the store never hands back a fresh object.
  const name = useWorkspaceStore((state) => activeWorkspace(state).name);
  const kind = useWorkspaceStore((state) => activeWorkspace(state).kind);
  const location = itemStorageLocation(item, { name, kind });
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
        : location.kind === 'device'
          ? translateUi('Saved on this device')
          : translateUi('Saved on the Home server · {{workspace}}', {
              workspace: location.workspaceName,
            })}
    </div>
  );
}
