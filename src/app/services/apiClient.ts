import axios, { type AxiosError, type InternalAxiosRequestConfig, type Method } from 'axios';
import { useAuthStore } from '../stores/useAuthStore';
import { logger } from './logger';
import { getOfflineQueueScope, offlineQueue } from './offlineQueue';

const apiClient = axios.create();

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let isRefreshing = false;
let refreshSubscribers: { resolve: (token: string) => void; reject: (error: unknown) => void }[] =
  [];

function onTokenRefreshed(newToken: string) {
  refreshSubscribers.forEach((sub) => sub.resolve(newToken));
  refreshSubscribers = [];
}

function onTokenRefreshFailed(error: unknown) {
  refreshSubscribers.forEach((sub) => sub.reject(error));
  refreshSubscribers = [];
}

function addRefreshSubscriber(resolve: (token: string) => void, reject: (error: unknown) => void) {
  refreshSubscribers.push({ resolve, reject });
}

// Request interceptor: attach baseURL and Authorization header from auth store
apiClient.interceptors.request.use((config) => {
  const { token, serverUrl } = useAuthStore.getState();
  config.baseURL = `${serverUrl}/api`;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle network errors + token refresh on 401
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;

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
      // For mutations: enqueue and return a stub so optimistic state stays
      if (method !== 'GET') {
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
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    const { refreshToken, serverUrl } = useAuthStore.getState();

    // No refresh token available — log out immediately
    if (!refreshToken) {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    // If already refreshing, queue this request
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        addRefreshSubscriber(
          (newToken: string) => {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            originalRequest._retry = true;
            resolve(apiClient(originalRequest));
          },
          (err: unknown) => {
            reject(err);
          },
        );
      });
    }

    isRefreshing = true;

    try {
      const response = await axios.post(`${serverUrl}/api/auth/refresh`, {
        refresh_token: refreshToken,
      });

      const newToken: string = response.data.access_token;
      const newRefreshToken: string = response.data.refresh_token;
      useAuthStore.getState().setTokens(newToken, newRefreshToken);

      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      originalRequest._retry = true;
      onTokenRefreshed(newToken);

      return apiClient(originalRequest);
    } catch (refreshError) {
      onTokenRefreshFailed(refreshError);
      logger.error('Token refresh error, logging out', refreshError);
      useAuthStore.getState().logout();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export default apiClient;
