import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { platformApi } from '../../platform';
import { IS_DESKTOP } from '../../types/platform';
import { logger } from '../../services/logger';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
  /** Offered when the camera cannot be used, so the user is never stuck here. */
  onManualEntry?: () => void;
}

/** Why the camera could not start — drives which recovery action we offer. */
type CameraFailure = 'denied' | 'notFound' | 'inUse' | 'insecure' | 'unsupported' | 'failed';

/**
 * Map a getUserMedia rejection to a cause the user can act on.
 *
 * Reporting every failure as "access denied" sent people to a permission
 * screen that had nothing wrong with it, with no way back.
 */
function classifyCameraError(error: unknown): CameraFailure {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'notFound';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'inUse';
    default:
      return 'failed';
  }
}

export default function QRScanner({ onScan, onClose, onManualEntry }: QRScannerProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(true);
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const retry = useCallback(() => {
    setFailure(null);
    setSettingsError(false);
    scanningRef.current = true;
    setAttempt((value) => value + 1);
  }, []);

  const openSettings = useCallback(async () => {
    setSettingsError(false);
    try {
      await platformApi.system.openCameraSettings();
    } catch (error) {
      logger.warn('Could not open camera settings', error);
      setSettingsError(true);
    }
  }, []);

  useEffect(() => {
    let animFrame: number;
    scanningRef.current = true;

    const startScanning = async () => {
      // A webview served over plain HTTP from a non-local origin has no
      // mediaDevices at all, which is a different problem from a denied prompt.
      if (!navigator.mediaDevices?.getUserMedia) {
        setFailure(window.isSecureContext ? 'unsupported' : 'insecure');
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
          });
        } catch (error) {
          // Desktops usually have only a front-facing camera, so the
          // environment constraint is a preference, not a requirement.
          if (error instanceof Error && error.name === 'OverconstrainedError') {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
          } else {
            throw error;
          }
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (error) {
        logger.warn('Camera could not be started', error);
        setFailure(classifyCameraError(error));
        return;
      }

      // Use BarcodeDetector if available, otherwise fall back to scanning via canvas
      const hasDetector = 'BarcodeDetector' in window;
      let detector: InstanceType<typeof BarcodeDetector> | null = null;
      if (hasDetector) {
        detector = new BarcodeDetector({ formats: ['qr_code'] });
      }

      const scan = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        const video = videoRef.current;

        if (detector && video.readyState >= 2) {
          try {
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0) {
              stopCamera();
              onScan(barcodes[0].rawValue);
              return;
            }
          } catch {
            /* detection failed, retry */
          }
        }

        animFrame = requestAnimationFrame(scan);
      };

      scan();
    };

    void startScanning();

    return () => {
      cancelAnimationFrame(animFrame);
      stopCamera();
    };
  }, [onScan, stopCamera, attempt]);

  const buttonStyle = {
    padding: '10px 24px',
    background: 'rgba(255,255,255,0.15)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 8,
    fontSize: 15,
    cursor: 'pointer',
  } as const;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.9)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      {!failure && (
        <div
          style={{
            position: 'relative',
            width: 280,
            height: 280,
            borderRadius: 16,
            overflow: 'hidden',
            border: '2px solid rgba(255,255,255,0.3)',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          {/* Scan frame overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              border: '3px solid rgba(255,255,255,0.6)',
              borderRadius: 16,
              pointerEvents: 'none',
            }}
          />
        </div>
      )}

      {failure ? (
        <div style={{ maxWidth: 320, textAlign: 'center' }}>
          <div style={{ color: '#ff6b6b', fontSize: 15, marginBottom: 8 }}>
            {t(`camera.${failure}`)}
          </div>
          {failure === 'denied' && (
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginBottom: 16 }}>
              {t('camera.deniedHint')}
            </div>
          )}
          {settingsError && (
            <div style={{ color: '#ffaa00', fontSize: 12, marginBottom: 12 }}>
              {t('camera.openSettingsFailed')}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              justifyContent: 'center',
            }}
          >
            {failure === 'denied' && IS_DESKTOP && (
              <button type="button" onClick={() => void openSettings()} style={buttonStyle}>
                {t('camera.openSettings')}
              </button>
            )}
            {failure !== 'unsupported' && failure !== 'insecure' && (
              <button type="button" onClick={retry} style={buttonStyle}>
                {t('camera.retry')}
              </button>
            )}
            {onManualEntry && (
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  onManualEntry();
                }}
                style={buttonStyle}
              >
                {t('camera.enterCodeInstead')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ color: '#fff', marginTop: 16, fontSize: 14 }}>{t('camera.prompt')}</div>
      )}

      {!('BarcodeDetector' in window) && !failure && (
        <div
          style={{
            color: '#ffaa00',
            marginTop: 8,
            fontSize: 12,
            textAlign: 'center',
            maxWidth: 280,
          }}
        >
          {t('camera.noScannerHint')}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          stopCamera();
          onClose();
        }}
        style={{ ...buttonStyle, marginTop: 24, padding: '10px 32px' }}
      >
        {t('camera.cancel')}
      </button>
    </div>
  );
}

// Type declaration for BarcodeDetector (not yet in all TS libs)
declare global {
  class BarcodeDetector {
    constructor(options?: { formats: string[] });
    detect(
      source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
    ): Promise<Array<{ rawValue: string }>>;
  }
}
