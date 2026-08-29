/**
 * Where the desktop shell writes the records a stuck launch leaves behind.
 *
 * The Rust side appends startup failures to `<data dir>/com.clawchat.desktop/
 * startup.log` and pipes the bundled server's own stdout/stderr into
 * `server.log` next to it. Those files are the only place a packaged app can
 * explain itself, so the login screen has to be able to name them.
 */
const APP_DATA_DIRECTORY = 'com.clawchat.desktop';

export interface StartupLogLocation {
  /** Directory holding both `startup.log` and `server.log`. */
  directory: string;
  startupLog: string;
  serverLog: string;
}

function dataDirectoryFor(userAgent: string): string {
  if (/mac os x|macintosh/i.test(userAgent)) {
    return `~/Library/Application Support/${APP_DATA_DIRECTORY}`;
  }
  if (/windows/i.test(userAgent)) {
    return `%APPDATA%\\${APP_DATA_DIRECTORY}`;
  }
  return `~/.local/share/${APP_DATA_DIRECTORY}`;
}

export function describeStartupLogLocation(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): StartupLogLocation {
  const directory = dataDirectoryFor(userAgent);
  const separator = directory.includes('\\') ? '\\' : '/';
  return {
    directory,
    startupLog: `${directory}${separator}startup.log`,
    serverLog: `${directory}${separator}server.log`,
  };
}
