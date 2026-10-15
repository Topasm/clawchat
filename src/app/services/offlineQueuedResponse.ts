export const OFFLINE_QUEUED_STATUS_TEXT = 'offline-queued';

/** The mutation did not reach the server; it waits in this device's offline queue. */
export function isOfflineQueuedResponse(response: {
  status?: number;
  statusText?: string;
}): boolean {
  return response.status === 0 && response.statusText === OFFLINE_QUEUED_STATUS_TEXT;
}
