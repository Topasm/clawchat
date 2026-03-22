import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../../services/apiClient';

interface PairingCodeDisplayProps {
  onPaired?: () => void;
  compact?: boolean;
}

import type { PairingSession } from '../../types/connection';

type DisplayState = 'loading' | 'active' | 'paired' | 'error';

export default function PairingCodeDisplay({ onPaired, compact = false }: PairingCodeDisplayProps) {
  const [session, setSession] = useState<PairingSession | null>(null);
  const [state, setState] = useState<DisplayState>('loading');
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    setCopied(false);

    try {
      const res = await apiClient.post('/pairing/session');
      const data: PairingSession = {
        code: res.data.code,
        expiresAt: res.data.expires_at,
        qrPayload: res.data.qr_payload,
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
          if (devices.length > 0) {
            clearTimers();
            setState('paired');
            onPaired?.();
          }
        } catch {
          // Polling error, keep trying
        }
      }, 3000);
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to generate pairing code');
    }
  }, [clearTimers, onPaired]);

  useEffect(() => {
    generateCode();
    return clearTimers;
  }, [generateCode, clearTimers]);

  const handleCopyPayload = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.qrPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (state === 'loading') {
    return (
      <div className={`cc-pairing-code-display ${compact ? 'cc-pairing-code-display--compact' : ''}`}>
        <div className="cc-pairing-code-display__loading">
          <div className="cc-pairing-code-display__spinner" />
          <span>Generating pairing code...</span>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={`cc-pairing-code-display ${compact ? 'cc-pairing-code-display--compact' : ''}`}>
        <div className="cc-pairing-code-display__error">
          <span className="cc-pairing-code-display__error-text">{error}</span>
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={generateCode}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (state === 'paired') {
    return (
      <div className={`cc-pairing-code-display ${compact ? 'cc-pairing-code-display--compact' : ''}`}>
        <div className="cc-pairing-code-display__success">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--cc-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="24" cy="24" r="20" />
            <path d="M16 24l5 5 11-11" />
          </svg>
          <span className="cc-pairing-code-display__success-text">Paired!</span>
          <span className="cc-pairing-code-display__success-sub">Device successfully connected</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`cc-pairing-code-display ${compact ? 'cc-pairing-code-display--compact' : ''}`}>
      {!compact && (
        <div className="cc-pairing-code-display__header">
          <span className="cc-pairing-code-display__title">Pair a Mobile Device</span>
          <span className="cc-pairing-code-display__subtitle">
            Enter this code on your mobile device to connect
          </span>
        </div>
      )}

      <div className="cc-pairing-code-display__code-container">
        <div className="cc-pairing-code-display__digits">
          {session?.code.split('').map((digit, i) => (
            <span key={i} className="cc-pairing-code-display__digit">{digit}</span>
          ))}
        </div>
        <div className="cc-pairing-code-display__countdown">
          {secondsLeft > 0 ? (
            <span className={secondsLeft <= 30 ? 'cc-pairing-code-display__countdown--warning' : ''}>
              Expires in {formatTime(secondsLeft)}
            </span>
          ) : (
            <span className="cc-pairing-code-display__countdown--expired">Refreshing...</span>
          )}
        </div>
      </div>

      {session?.qrPayload && (
        <div className="cc-pairing-code-display__qr-section">
          <label className="cc-pairing-code-display__qr-label">QR Payload</label>
          <div className="cc-pairing-code-display__qr-row">
            <code className="cc-pairing-code-display__qr-value">{session.qrPayload}</code>
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              onClick={handleCopyPayload}
              style={{ fontSize: 12, padding: '4px 10px', flexShrink: 0 }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="cc-btn cc-btn--ghost cc-pairing-code-display__refresh"
        onClick={generateCode}
        style={{ fontSize: 12, padding: '4px 10px' }}
      >
        Generate new code
      </button>
    </div>
  );
}
