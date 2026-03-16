import { useEffect, useRef, useState, useCallback } from 'react';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(true);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let animFrame: number;

    const startScanning = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setError('Camera access denied');
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
          } catch { /* detection failed, retry */ }
        }

        animFrame = requestAnimationFrame(scan);
      };

      scan();
    };

    startScanning();

    return () => {
      cancelAnimationFrame(animFrame);
      stopCamera();
    };
  }, [onScan, stopCamera]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.9)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'relative', width: 280, height: 280,
        borderRadius: 16, overflow: 'hidden',
        border: '2px solid rgba(255,255,255,0.3)',
      }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {/* Scan frame overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          border: '3px solid rgba(255,255,255,0.6)',
          borderRadius: 16,
          pointerEvents: 'none',
        }} />
      </div>

      {error ? (
        <div style={{ color: '#ff6b6b', marginTop: 16, fontSize: 14 }}>{error}</div>
      ) : (
        <div style={{ color: '#fff', marginTop: 16, fontSize: 14 }}>
          Point camera at QR code
        </div>
      )}

      {!('BarcodeDetector' in window) && !error && (
        <div style={{ color: '#ffaa00', marginTop: 8, fontSize: 12, textAlign: 'center', maxWidth: 280 }}>
          QR scanning not supported on this browser. Please enter the server URL and PIN manually.
        </div>
      )}

      <button
        type="button"
        onClick={() => { stopCamera(); onClose(); }}
        style={{
          marginTop: 24, padding: '10px 32px',
          background: 'rgba(255,255,255,0.15)',
          color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: 8, fontSize: 15, cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  );
}

// Type declaration for BarcodeDetector (not yet in all TS libs)
declare global {
  class BarcodeDetector {
    constructor(options?: { formats: string[] });
    detect(source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap): Promise<Array<{ rawValue: string }>>;
  }
}
