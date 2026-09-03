import { useEffect } from 'react';
import { platformApi } from '../platform';
import { logger } from '../services/logger';
import { WorkerRunner } from '../services/workerRunner';
import { useAuthStore } from '../stores/useAuthStore';
import { useSettingsStore } from '../stores/useSettingsStore';

/**
 * Keeps this machine collecting the work addressed to it while the app is open
 * and the setting is on.
 *
 * Tied to the window on purpose. A worker exists only while its app runs, and
 * the server treats silence as the machine being gone — so closing the app is
 * the same statement as switching this off, and neither strands work, because
 * nothing is ever queued for a machine that is not answering.
 */
export default function useWorkerRunner(): void {
  const workerEnabled = useSettingsStore((state) => state.workerEnabled);
  const workerLabel = useSettingsStore((state) => state.workerLabel);
  const workerProvider = useSettingsStore((state) => state.workerProvider);
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    // No shell means no machine to run on, no session means nothing to ask,
    // and an unnamed machine has nothing to be addressed as.
    const label = workerLabel.trim();
    if (!workerEnabled || !platformApi.worker || !token || !label) return;

    const runner = new WorkerRunner({ label, provider: workerProvider });
    void runner.start().catch((error) => {
      logger.warn('Could not start the worker on this machine', error);
    });

    return () => runner.stop();
  }, [workerEnabled, workerLabel, workerProvider, token]);
}
