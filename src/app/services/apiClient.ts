import axios, { type AxiosError, type InternalAxiosRequestConfig, type Method } from 'axios';
import { useAuthStore } from '../stores/useAuthStore';
import { logger } from './logger';
import { getOfflineQueueScope, offlineQueue } from './offlineQueue';
import { refreshAuthSession } from './sessionRefresh';
import { debugResource, getDebugSnapshot, recordDebug } from './debugLogging';

declare module 'axios' {
  // Keep Axios' generic defaults identical so request helpers such as
  // `apiClient.post` accept the ClawChat-specific transport option.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface AxiosRequestConfig<D = any, P = any> {
    /** Opt in only for JSON mutations that are safe to replay after reconnecting. */
    queueOfflineMutation?: boolean;
    diagnosticStartedAt?: number;
  }
}

const apiClient = axios.create();

function diagnosticMethod(method = 'GET'): string {
  const normalized = method.toUpperCase();
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(normalized)
    ? normalized
    : 'OTHER';
}
function recordTransport(config: InternalAxiosRequestConfig, status?: number) {
  if (config.diagnosticStartedAt == null) return;
  recordDebug({
    event: status == null ? 'network-failure' : 'response',
    resource: debugResource(config.url),
    method: diagnosticMethod(config.method),
    status,
    durationMs: Math.round(performance.now() - config.diagnosticStartedAt),
  });
}

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

// Request interceptor: attach baseURL and Authorization header from auth store
apiClient.interceptors.request.use((config) => {
  if (getDebugSnapshot().enabled) {
    config.diagnosticStartedAt = performance.now();
    recordDebug({
      event: 'request',
      resource: debugResource(config.url),
      method: diagnosticMethod(config.method),
    });
  } else delete config.diagnosticStartedAt;
  const { token, serverUrl } = useAuthStore.getState();
  config.baseURL = `${serverUrl}/api`;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle network errors + token refresh on 401
apiClient.interceptors.response.use(
  (response) => {
    recordTransport(response.config, response.status);
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    if (originalRequest) recordTransport(originalRequest, error.response?.status);

    // Detect network error (no response at all, e.g. offline)
    const isNetworkError =
      !error.response && (error.code === 'ERR_NETWORK' || error.message === 'Network Error');
    if (isNetworkError && originalRequest) {
      const { relayUrl, hostId, hostPublicKey, token, serverUrl } = useAuthStore.getState();
      if (relayUrl && hostId && hostPublicKey) {
        const relayConfig = { relayUrl, hostId, hostPublicKey };
        const { relayClient } = await import('./relayClient');
        try {
          const requestUrl = originalRequest.url ?? '';
          const path = requestUrl.startsWith('/api/')
            ? requestUrl
            : `/api/${requestUrl.replace(/^\/+/, '')}`;
          const relayResponse = await relayClient.request(relayConfig, {
            method: originalRequest.method ?? 'GET',
            path,
            headers: {
              ...(token ? { authorization: `Bearer ${token}` } : {}),
              ...(originalRequest.headers?.['Content-Type']
                ? { 'content-type': String(originalRequest.headers['Content-Type']) }
                : {}),
            },
            body:
              typeof originalRequest.data === 'string'
                ? originalRequest.data
                : originalRequest.data == null
                  ? null
                  : JSON.stringify(originalRequest.data),
          });
          recordDebug({
            event: 'relay-response',
            status: relayResponse.status,
            resource: debugResource(originalRequest.url),
          });
          if (relayResponse.status >= 400) {
            const relayError = new Error(
              `Relay API request failed: ${relayResponse.status}`,
            ) as Error & {
              response?: { status: number; data: unknown };
            };
            relayError.response = { status: relayResponse.status, data: relayResponse.data };
            return Promise.reject(relayError);
          }
          return {
            data: relayResponse.data,
            status: relayResponse.status,
            statusText: 'relay',
            headers: relayResponse.headers,
            config: originalRequest,
          };
        } catch (relayError) {
          if (
            relayError &&
            typeof relayError === 'object' &&
            'response' in relayError &&
            relayError.response
          ) {
            return Promise.reject(relayError);
          }
          logger.warn('Relay fallback failed', relayError);
        }
      }
      const method = (originalRequest.method ?? 'get').toUpperCase();
      // Offline replay is deliberately opt-in. Command endpoints, destructive
      // admin actions, and binary bodies must fail while disconnected instead
      // of executing later without fresh user intent.
      if (method !== 'GET') {
        if (originalRequest.queueOfflineMutation !== true) {
          return Promise.reject(error);
        }
        let body = originalRequest.data;
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body);
          } catch {
            /* keep as-is */
          }
        }
        const queued = offlineQueue.enqueue(
          getOfflineQueueScope({ serverUrl, token }),
          originalRequest.method as Method,
          originalRequest.url ?? '',
          body,
        );
        if (!queued) return Promise.reject(error);
        return {
          data: {},
          status: 0,
          statusText: 'offline-queued',
          headers: {},
          config: originalRequest,
        };
      }
      // For GETs: reject normally — React Query handles retries
      return Promise.reject(error);
    }

    if (!originalRequest || error.response?.status !== 401) {
      logger.warn('API request failed', {
        url: originalRequest?.url,
        status: error.response?.status,
      });
      return Promise.reject(error);
    }

    // Prevent infinite 401 loop: if this request was already retried, reject immediately
    if (originalRequest._retry) {
      return Promise.reject(error);
    }

    // Avoid infinite loop on the refresh endpoint itself
    if (originalRequest.url?.includes('/auth/refresh')) {
      logger.warn('Token refresh failed, logging out');
      await useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    const { refreshToken } = useAuthStore.getState();

    // No refresh token available — log out immediately
    if (!refreshToken) {
      await useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    try {
      const newToken = await refreshAuthSession();

      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      originalRequest._retry = true;

      return apiClient(originalRequest);
    } catch (refreshError) {
      logger.error('Token refresh error, logging out', refreshError);
      return Promise.reject(refreshError);
    }
  },
);

export default apiClient;
