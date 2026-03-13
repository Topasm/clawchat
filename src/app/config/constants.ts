const DEFAULT_DEV_SERVER_URL = 'http://localhost:8000';

function resolveDefaultServerUrl() {
  if (typeof window === 'undefined') {
    return DEFAULT_DEV_SERVER_URL;
  }

  const { protocol, hostname, port, origin } = window.location;
  const isViteDevServer = (hostname === 'localhost' || hostname === '127.0.0.1') && port === '5173';
  const isFileProtocol = protocol === 'file:';

  if (isViteDevServer || isFileProtocol) {
    return DEFAULT_DEV_SERVER_URL;
  }

  return origin;
}

export const DEFAULT_SERVER_URL = resolveDefaultServerUrl();
