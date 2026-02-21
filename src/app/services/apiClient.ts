import axios, { type AxiosError } from 'axios';
import { useAuthStore } from '../stores/useAuthStore';

const apiClient = axios.create();

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function onTokenRefreshed(newToken: string) {
  refreshSubscribers.forEach((cb) => cb(newToken));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
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

// Response interceptor: try token refresh on 401, then logout if that also fails
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;
    if (!originalRequest || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    // Avoid infinite loop on the refresh endpoint itself
    if (originalRequest.url?.includes('/auth/refresh')) {
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
      return new Promise((resolve) => {
        addRefreshSubscriber((newToken: string) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          resolve(apiClient(originalRequest));
        });
      });
    }

    isRefreshing = true;

    try {
      const response = await axios.post(`${serverUrl}/api/auth/refresh`, {
        refresh_token: refreshToken,
      });

      const newToken: string = response.data.access_token;
      useAuthStore.getState().setToken(newToken);

      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      onTokenRefreshed(newToken);

      return apiClient(originalRequest);
    } catch {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  },
);

export default apiClient;
