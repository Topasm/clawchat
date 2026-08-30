import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from '../../i18n';
import apiClient from '../../services/apiClient';
import { CheckCircleIcon } from '../shared/Icons';

interface PairingCodeDisplayProps {
  onPaired?: () => void;
  compact?: boolean;
}

import type { PairingSession } from '../../types/connection';

type DisplayState = 'loading' | 'active' | 'paired' | 'error';

export default function PairingCodeDisplay({ onPaired, compact = false }: PairingCodeDisplayProps) {
  const { t } = useTranslation();
  const [session, setSession] = useState<PairingSession | null>(null);
  const [state, setState] = useState<DisplayState>('loading');
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialDeviceCountRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const generateCode = useCallback(async () => {
    clearTimers();
    setState('loading');
    setError('');

    try {
      // Capture current device count before generating code
      try {
        const devRes = await apiClient.get('/pairing/devices');
        const devices = devRes.data?.items ?? devRes.data ?? [];
        initialDeviceCountRef.current = devices.length;
      } catch {
        initialDeviceCountRef.current = 0;
      }

      const res = await apiClient.post('/pairing/session');
      const data: PairingSession = {
        code: res.data.code,
        expiresAt: res.data.expires_at,
        qrPayload: res.data.qr_payload,
        hostId: res.data.host_id,
        hostPublicKey: res.data.host_public_key,
        relayUrl: res.data.relay_url ?? null,
      };
      setSession(data);
      setState('active');

      // Calculate seconds until expiry
      const expiresAt = new Date(data.expiresAt).getTime();
      const updateCountdown = () => {
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
        setSecondsLeft(remaining);
        if (remaining <= 0) {
          // Code expired, auto-refresh
          generateCode();
        }
      };
      updateCountdown();
      countdownRef.current = setInterval(updateCountdown, 1000);

      // Poll for device claiming the code
      pollRef.current = setInterval(async () => {
        try {
          const devRes = await apiClient.get('/pairing/devices');
          const devices = devRes.data?.items ?? devRes.data ?? [];
          if (devices.length > (initialDeviceCountRef.current ?? 0)) {
            clearTimers();
            setState('paired');
            onPaired?.();
          }
        } catch {
          // Polling error, keep trying
        }
      }, 3000);
    } catch {
      setState('error');
      setError(t('workspaceSettings.pairing.generateFailed'));
    }
  }, [clearTimers, onPaired, t]);

  useEffect(() => {
    generateCode();
    return clearTimers;
  }, [generateCode, clearTimers]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (state === 'loading') {
    return (
      <div
        className={`cc-pairing-code-display ${compact ? 'cc-pairing-code-display--compact' : ''}`}
      >
        <div className="cc-pairing-code-display__loading">
          <div className="cc-pairing-code-display__spinner" />
          <span>{t('workspaceSettings.pairing.generating')}</span>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div
        className={`cc-pairing-code-display ${compact ? 'cc-pairing-code-display--compact' : ''}`}
      >
        <div className="cc-pairing-code-display__error">
          <span className="cc-pairing-code-display__error-text">{error}</span>
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={generateCode}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {t('workspaceSettings.actions.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (state === 'paired') {
    return (
      <div
        className={`cc-pairing-code-display ${compact ? 'cc-pairing-code-display--compact' : ''}`}
      >
        <div className="cc-pairing-code-display__success">
          <CheckCircleIcon size={48} style={{ color: 'var(--cc-success)' }} />
          <span className="cc-pairing-code-display__success-text">
            {t('workspaceSettings.pairing.paired')}
          </span>
          <span className="cc-pairing-code-display__success-sub">
            {t('workspaceSettings.pairing.connected')}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`cc-pairing-code-display ${compact ? 'cc-pairing-code-display--compact' : ''}`}>
      {!compact && (
        <div className="cc-pairing-code-display__header">
          <span className="cc-pairing-code-display__title">
            {t('workspaceSettings.pairing.title')}
          </span>
          <span className="cc-pairing-code-display__subtitle">
            {t('workspaceSettings.pairing.subtitle')}
          </span>
        </div>
      )}

      {session?.qrPayload && (
        <div className="cc-pairing-code-display__qr-image">
          <QRCodeSVG value={session.qrPayload} size={compact ? 160 : 200} />
        </div>
      )}

      <div className="cc-pairing-code-display__code-container">
        <div className="cc-pairing-code-display__digits">
          {session?.code.split('').map((digit, i) => (
            <span key={i} className="cc-pairing-code-display__digit">
              {digit}
            </span>
          ))}
        </div>
        <div className="cc-pairing-code-display__countdown">
          {secondsLeft > 0 ? (
            <span
              className={secondsLeft <= 30 ? 'cc-pairing-code-display__countdown--warning' : ''}
            >
              {t('workspaceSettings.pairing.expiresIn', { time: formatTime(secondsLeft) })}
            </span>
          ) : (
            <span className="cc-pairing-code-display__countdown--expired">
              {t('workspaceSettings.pairing.refreshing')}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        className="cc-btn cc-btn--ghost cc-pairing-code-display__refresh"
        onClick={generateCode}
        style={{ fontSize: 12, padding: '4px 10px' }}
      >
        {t('workspaceSettings.actions.generateNewCode')}
      </button>
    </div>
  );
}
