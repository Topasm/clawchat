import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { IS_ELECTRON } from '../../types/platform';

interface NetworkAddress {
  ip: string;
  name: string;
  isTailscale: boolean;
}

interface ServerConfig {
  port: number;
  pin: string;
}

export default function MobileConnectionPanel() {
  const [addresses, setAddresses] = useState<NetworkAddress[]>([]);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!IS_ELECTRON) return;
    const [netInfo, cfg] = await Promise.all([
      window.electronAPI.server.getNetworkInfo(),
      window.electronAPI.server.getConfig(),
    ]);
    setAddresses(netInfo.addresses);
    setConfig(cfg);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (!config) return null;

  const bestAddr = addresses[0];
  const bestUrl = bestAddr ? `http://${bestAddr.ip}:${config.port}` : `http://localhost:${config.port}`;
  const qrData = JSON.stringify({ serverUrl: bestUrl, pin: config.pin });

  const copyPin = async () => {
    await navigator.clipboard.writeText(config.pin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* QR Code */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <QRCodeSVG value={qrData} size={200} />
        <span style={{ fontSize: 12, color: 'var(--cc-text-secondary)' }}>
          Scan with ClawChat mobile app
        </span>
      </div>

      {/* Best URL */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--cc-text-secondary)' }}>
          Server URL
        </label>
        <code style={{
          fontSize: 13,
          padding: '6px 10px',
          background: 'var(--cc-bg-secondary)',
          borderRadius: 6,
          wordBreak: 'break-all',
        }}>
          {bestUrl}
          {bestAddr?.isTailscale && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--cc-success)' }}>
              Tailscale
            </span>
          )}
        </code>
      </div>

      {/* PIN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--cc-text-secondary)' }}>
          PIN
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{
            fontSize: 18,
            fontWeight: 600,
            padding: '6px 10px',
            background: 'var(--cc-bg-secondary)',
            borderRadius: 6,
            letterSpacing: 4,
          }}>
            {showPin ? config.pin : '\u2022\u2022\u2022\u2022\u2022\u2022'}
          </code>
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => setShowPin(!showPin)}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {showPin ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={copyPin}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* All addresses */}
      {addresses.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--cc-text-secondary)' }}>
            All detected addresses
          </label>
          <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {addresses.map((a) => (
              <div key={a.ip} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '3px 8px',
                background: 'var(--cc-bg-secondary)',
                borderRadius: 4,
              }}>
                <span style={{ fontFamily: 'monospace' }}>http://{a.ip}:{config.port}</span>
                <span style={{ color: 'var(--cc-text-tertiary)' }}>({a.name})</span>
                {a.isTailscale && (
                  <span style={{ fontSize: 10, color: 'var(--cc-success)' }}>Tailscale</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Refresh */}
      <button
        type="button"
        className="cc-btn cc-btn--secondary"
        onClick={refresh}
        style={{ fontSize: 12, padding: '4px 10px', alignSelf: 'flex-start' }}
      >
        Refresh
      </button>
    </div>
  );
}
