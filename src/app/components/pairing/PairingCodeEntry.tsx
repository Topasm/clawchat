import { useState, useRef, useCallback, type KeyboardEvent, type ClipboardEvent } from 'react';
import apiClient from '../../services/apiClient';
import { IS_IOS, IS_ANDROID } from '../../types/platform';

interface PairingCodeEntryProps {
  onPaired?: (deviceToken: string) => void;
}

type EntryState = 'idle' | 'submitting' | 'success' | 'error';

function detectDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Samsung/.test(ua)) return 'Samsung Device';
  if (/Pixel/.test(ua)) return 'Pixel';
  if (/Huawei/i.test(ua)) return 'Huawei Device';
  if (/Android/.test(ua)) return 'Android Device';
  return 'Mobile Device';
}

function detectDeviceType(): string {
  if (IS_IOS) return 'ios';
  if (IS_ANDROID) return 'android';
  // Fallback: guess from user agent
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return 'ios';
  if (/Android/.test(navigator.userAgent)) return 'android';
  return 'unknown';
}

const CODE_LENGTH = 6;

export default function PairingCodeEntry({ onPaired }: PairingCodeEntryProps) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [state, setState] = useState<EntryState>('idle');
  const [error, setError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const setInputRef = useCallback((index: number) => (el: HTMLInputElement | null) => {
    inputRefs.current[index] = el;
  }, []);

  const focusInput = (index: number) => {
    if (index >= 0 && index < CODE_LENGTH) {
      inputRefs.current[index]?.focus();
    }
  };

  const updateDigit = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = cleaned;
      return next;
    });
    setError('');
    setState('idle');
    if (cleaned && index < CODE_LENGTH - 1) {
      focusInput(index + 1);
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        e.preventDefault();
        setDigits((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
        focusInput(index - 1);
      } else {
        setDigits((prev) => {
          const next = [...prev];
          next[index] = '';
          return next;
        });
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      focusInput(index - 1);
    } else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      e.preventDefault();
      focusInput(index + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (pasted.length > 0) {
      const newDigits = Array(CODE_LENGTH).fill('');
      for (let i = 0; i < pasted.length && i < CODE_LENGTH; i++) {
        newDigits[i] = pasted[i];
      }
      setDigits(newDigits);
      setError('');
      setState('idle');
      focusInput(Math.min(pasted.length, CODE_LENGTH - 1));
    }
  };

  const code = digits.join('');
  const isComplete = code.length === CODE_LENGTH && digits.every((d) => d !== '');

  const handleSubmit = async () => {
    if (!isComplete) return;

    setState('submitting');
    setError('');

    try {
      const res = await apiClient.post('/pairing/claim', {
        code,
        device_name: detectDeviceName(),
        device_type: detectDeviceType(),
      });

      const deviceToken: string = res.data?.device_token ?? res.data?.token ?? '';
      setState('success');
      onPaired?.(deviceToken);
    } catch (err: unknown) {
      setState('error');
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
        const status = axiosErr.response?.status;
        const detail = axiosErr.response?.data?.detail;

        if (status === 404 || status === 400) {
          setError(detail ?? 'Invalid code');
        } else if (status === 410) {
          setError(detail ?? 'Code expired');
        } else {
          setError(detail ?? 'Failed to pair device');
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to pair device');
      }
    }
  };

  if (state === 'success') {
    return (
      <div className="cc-pairing-code-entry">
        <div className="cc-pairing-code-entry__success">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="var(--cc-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="20" cy="20" r="16" />
            <path d="M13 20l4 4 10-10" />
          </svg>
          <span className="cc-pairing-code-entry__success-text">Device paired!</span>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-pairing-code-entry">
      <div className="cc-pairing-code-entry__header">
        <span className="cc-pairing-code-entry__title">Enter Pairing Code</span>
        <span className="cc-pairing-code-entry__subtitle">
          Enter the 6-digit code shown on your desktop
        </span>
      </div>

      <div className="cc-pairing-code-entry__inputs">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={setInputRef(i)}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            onChange={(e) => updateDigit(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            onFocus={(e) => e.target.select()}
            className={`cc-pairing-code-entry__input ${error ? 'cc-pairing-code-entry__input--error' : ''}`}
            disabled={state === 'submitting'}
            autoComplete="one-time-code"
          />
        ))}
      </div>

      {error && (
        <div className="cc-pairing-code-entry__error">{error}</div>
      )}

      <button
        type="button"
        className="cc-btn cc-btn--primary cc-pairing-code-entry__submit"
        onClick={handleSubmit}
        disabled={!isComplete || state === 'submitting'}
      >
        {state === 'submitting' ? 'Pairing...' : 'Pair Device'}
      </button>
    </div>
  );
}
