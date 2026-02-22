import { useState, useEffect } from 'react';
import { IS_ELECTRON } from '../../types/platform';

type UpdateState = 'idle' | 'available' | 'downloading' | 'ready';

/**
 * Shows update notifications in Electron builds.
 * Listens for auto-updater events via the preload bridge.
 */
export default function UpdateNotification() {
  const [state, setState] = useState<UpdateState>('idle');
  const [version, setVersion] = useState('');

  useEffect(() => {
    if (!IS_ELECTRON) return;

    const api = window.electronAPI?.updater;
    if (!api) return;

    const removeAvailable = api.onUpdateAvailable((info) => {
      setVersion(info.version);
      setState('available');
    });

    const removeDownloaded = api.onUpdateDownloaded(() => {
      setState('ready');
    });

    return () => {
      removeAvailable();
      removeDownloaded();
    };
  }, []);

  if (!IS_ELECTRON || state === 'idle') return null;

  const handleDownload = async () => {
    setState('downloading');
    await window.electronAPI.updater.downloadUpdate();
  };

  const handleInstall = () => {
    window.electronAPI.updater.installUpdate();
  };

  return (
    <div className="cc-update-banner">
      {state === 'available' && (
        <>
          <span>Update available: v{version}</span>
          <button className="cc-update-banner__btn" onClick={handleDownload}>Download</button>
        </>
      )}
      {state === 'downloading' && (
        <span>Downloading update...</span>
      )}
      {state === 'ready' && (
        <>
          <span>Update ready — restart to apply</span>
          <button className="cc-update-banner__btn" onClick={handleInstall}>Restart Now</button>
        </>
      )}
    </div>
  );
}
