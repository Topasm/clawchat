const DEFAULT_DEV_SERVER_URL = 'http://localhost:8000';

function normalizeServerUrl(url: string | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, '');
}

const CONFIGURED_DEFAULT_SERVER_URL = normalizeServerUrl(import.meta.env.VITE_DEFAULT_SERVER_URL);

function resolveDefaultServerUrl() {
  if (CONFIGURED_DEFAULT_SERVER_URL) {
    return CONFIGURED_DEFAULT_SERVER_URL;
  }

  if (typeof window === 'undefined') {
    return DEFAULT_DEV_SERVER_URL;
  }

  const { protocol, hostname, port, origin } = window.location;
  const isViteDevServer = (hostname === 'localhost' || hostname === '127.0.0.1') && port === '5173';
  const isFileProtocol = protocol === 'file:';

  if (isViteDevServer || isFileProtocol) {
    return DEFAULT_DEV_SERVER_URL;
  }

  return origin.replace(/\/+$/, '');
}

export const DEFAULT_SERVER_URL = resolveDefaultServerUrl();
export const DEFAULT_SERVER_URL_PLACEHOLDER = CONFIGURED_DEFAULT_SERVER_URL ?? DEFAULT_SERVER_URL;
