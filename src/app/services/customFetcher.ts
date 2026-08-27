/**
 * Custom fetcher for Orval-generated React Query hooks.
 *
 * This wraps the existing apiClient axios instance so that all generated
 * hooks automatically get:
 *   - JWT token injection + automatic refresh on 401
 *   - Dynamic base URL from auth store
 *   - Offline mutation queue for network errors
 *
 * Orval calls this function instead of using a raw fetch/axios instance,
 * keeping the generated code decoupled from our auth infrastructure.
 */
import apiClient from './apiClient';
import type { AxiosRequestConfig } from 'axios';

/**
 * OpenAPI paths include the server's `/api` prefix, while apiClient already
 * uses `${serverUrl}/api` as its base URL. Keep generated requests on the same
 * relative-URL contract as the hand-written client to avoid `/api/api/...`.
 */
export const normalizeGeneratedApiUrl = (url: string): string => {
  if (url === '/api') return '/';
  return url.startsWith('/api/') ? url.slice('/api'.length) : url;
};

/**
 * These commands are revision-sensitive. Replaying one later from the
 * generic offline queue can apply or undo a plan against a different graph.
 */
export const isFailClosedGeneratedMutation = (method: string, url: string): boolean => {
  if (method.toUpperCase() === 'GET') return false;

  const relativeUrl = normalizeGeneratedApiUrl(url);
  return (
    /^\/todos\/[^/]+\/plan\/(?:generate|apply|dismiss)$/.test(relativeUrl) ||
    /^\/change-sets\/[^/]+\/revert$/.test(relativeUrl)
  );
};

export const customFetcher = <T>(config: {
  url: string;
  method: string;
  data?: unknown;
  params?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<T> => {
  const { url, method, data, params, headers, signal } = config;
  const failClosed = isFailClosedGeneratedMutation(method, url);

  const axiosConfig: AxiosRequestConfig = {
    url: normalizeGeneratedApiUrl(url),
    method,
    ...(data !== undefined && { data }),
    ...(params !== undefined && { params }),
    ...(headers !== undefined && { headers }),
    ...(signal !== undefined && { signal }),
    ...(failClosed && { queueOfflineMutation: false }),
  };

  return apiClient.request<T>(axiosConfig).then((response) => response.data);
};

export default customFetcher;
