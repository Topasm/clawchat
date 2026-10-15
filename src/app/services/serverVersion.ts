export interface VersionMismatch {
  appVersion: string;
  serverVersion: string;
  /** Which side is behind; `unknown` when the versions differ but do not compare. */
  older: 'app' | 'server' | 'unknown';
}

function parts(version: string): number[] | null {
  const core = version.trim().replace(/^v/i, '').split(/[-+]/u)[0];
  if (!/^\d+(\.\d+)*$/u.test(core)) return null;
  return core.split('.').map(Number);
}

/** Negative when `left` is older, positive when newer, null when either does not parse. */
export function compareVersions(left: string, right: string): number | null {
  const a = parts(left);
  const b = parts(right);
  if (!a || !b) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The app and the server it talks to ship from one release, so any difference
 * is worth telling the user about. Versions the server or a dev build cannot
 * name (`unknown`, empty) are not a mismatch.
 */
export function findVersionMismatch(
  appVersion: string | null | undefined,
  serverVersion: string | null | undefined,
): VersionMismatch | null {
  const app = appVersion?.trim().replace(/^v/i, '') ?? '';
  const server = serverVersion?.trim().replace(/^v/i, '') ?? '';
  if (!app || !server || app === 'unknown' || server === 'unknown') return null;
  if (!parts(app) || !parts(server)) return null;
  const comparison = compareVersions(app, server);
  if (comparison === 0) return null;
  return {
    appVersion: app,
    serverVersion: server,
    older: comparison === null ? 'unknown' : comparison < 0 ? 'app' : 'server',
  };
}
