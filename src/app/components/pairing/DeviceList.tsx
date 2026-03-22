import { usePairedDevices, useRevokeDevice } from '../../hooks/usePairing';
import type { PairedDevice } from '../../types/connection';

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
    return (
      <svg className="cc-device-list__icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="10" height="16" rx="2" />
        <line x1="10" y1="15" x2="10" y2="15.01" />
      </svg>
    );
  }
  if (type === 'android') {
    return (
      <svg className="cc-device-list__icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="4" width="10" height="14" rx="2" />
        <line x1="8" y1="2" x2="8" y2="4" />
        <line x1="12" y1="2" x2="12" y2="4" />
      </svg>
    );
  }
  return (
    <svg className="cc-device-list__icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <line x1="7" y1="18" x2="13" y2="18" />
    </svg>
  );
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
        <div className="cc-device-list__error">
          Failed to load devices
        </div>
      </div>
    );
  }

  const deviceList: PairedDevice[] = devices ?? [];

  if (deviceList.length === 0) {
    return (
      <div className="cc-device-list">
        <div className="cc-device-list__empty">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="var(--cc-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="8" y="4" width="16" height="24" rx="3" />
            <line x1="16" y1="24" x2="16" y2="24.01" strokeWidth="2" />
          </svg>
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
