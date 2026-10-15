import { useEffect, useMemo } from 'react';
import { platformApi } from '../platform';
import { DataSourceSharer } from '../services/dataSourceSharer';
import { getWorkerDeviceId } from '../services/workerIdentity';
import { useAuthStore } from '../stores/useAuthStore';
import { useSettingsStore, type SharedSourceSetting } from '../stores/useSettingsStore';

function sameServer(a: string | null, b: string): boolean {
  return !!a && a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

/**
 * Keeps this machine answering requests for the folders it shares with the
 * current workspace, while the app is open.
 *
 * Like the worker, sharing exists only while the window does: Home shows the
 * folders as offline once this stops asking, and serves only their names.
 */
export default function useDataSourceSharing(): void {
  const token = useAuthStore((state) => state.token);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const label = useSettingsStore((state) => state.workerLabel.trim());
  const allSources = useSettingsStore((state) => state.sharedSources);

  const sources = useMemo(
    () => allSources.filter((source) => sameServer(serverUrl, source.serverUrl)),
    [allSources, serverUrl],
  );
  // Restart only when what is shared changes, not when a server id is learned.
  const key = JSON.stringify(
    sources.map(({ remoteId: _remoteId, ...source }: SharedSourceSetting) => source),
  );

  useEffect(() => {
    if (!platformApi.worker || !token || !label || sources.length === 0) return;
    const sharer = new DataSourceSharer({
      label,
      deviceId: getWorkerDeviceId(),
      sources,
      onRegistered: (localId, remoteId) =>
        useSettingsStore.getState().updateSharedSource(localId, { remoteId }),
    });
    sharer.start();
    return () => sharer.stop();
    // `sources` is captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, label, key]);
}
