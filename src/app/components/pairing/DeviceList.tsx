import { usePairedDevices, useRevokeDevice } from '../../hooks/usePairing';
import type { PairedDevice } from '../../types/connection';
import { DeviceAndroidIcon, DeviceDesktopIcon, DevicePhoneIcon } from '../shared/Icons';

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function DeviceTypeIcon({ type }: { type: string }) {
  if (type === 'ios') {
    return <DevicePhoneIcon className="cc-device-list__icon" size={20} />;
  }
  if (type === 'android') {
    return <DeviceAndroidIcon className="cc-device-list__icon" size={20} />;
  }
  return <DeviceDesktopIcon className="cc-device-list__icon" size={20} />;
}

export default function DeviceList() {
  const { data: devices, isLoading, error } = usePairedDevices();
  const revokeDevice = useRevokeDevice();

  if (isLoading) {
    return (
      <div className="cc-device-list">
        <div className="cc-device-list__loading">Loading devices...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cc-device-list">
        <div className="cc-device-list__error">Failed to load devices</div>
      </div>
    );
  }

  const deviceList: PairedDevice[] = devices ?? [];

  if (deviceList.length === 0) {
    return (
      <div className="cc-device-list">
        <div className="cc-device-list__empty">
          <DevicePhoneIcon size={32} style={{ color: 'var(--cc-text-tertiary)' }} />
          <span>No devices paired yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-device-list">
      {deviceList.map((device) => (
        <div key={device.id} className="cc-device-list__item">
          <div className="cc-device-list__device-icon">
            <DeviceTypeIcon type={device.deviceType} />
          </div>
          <div className="cc-device-list__info">
            <div className="cc-device-list__name">{device.name}</div>
            <div className="cc-device-list__meta">
              <span>Paired {formatDate(device.pairedAt)}</span>
              <span className="cc-device-list__separator">|</span>
              <span>Last seen {formatRelativeTime(device.lastSeen)}</span>
            </div>
          </div>
          <button
            type="button"
            className="cc-btn cc-btn--danger cc-device-list__revoke"
            onClick={() => revokeDevice.mutate(device.id)}
            disabled={revokeDevice.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {revokeDevice.isPending ? 'Revoking...' : 'Revoke'}
          </button>
        </div>
      ))}
    </div>
  );
}
