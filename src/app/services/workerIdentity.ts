const WORKER_DEVICE_ID_KEY = 'clawchat-worker-device-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable machine identity. The user-facing worker label may be renamed. */
export function getWorkerDeviceId(): string {
  const existing = localStorage.getItem(WORKER_DEVICE_ID_KEY)?.trim();
  if (existing && UUID_PATTERN.test(existing)) return existing;

  const deviceId = crypto.randomUUID();
  localStorage.setItem(WORKER_DEVICE_ID_KEY, deviceId);
  return deviceId;
}
