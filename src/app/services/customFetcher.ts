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

export const customFetcher = <T>(config: {
  url: string;
  method: string;
  data?: unknown;
  params?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<T> => {
  const { url, method, data, params, headers, signal } = config;

  const axiosConfig: AxiosRequestConfig = {
    url,
    method,
    ...(data !== undefined && { data }),
    ...(params !== undefined && { params }),
    ...(headers !== undefined && { headers }),
    ...(signal !== undefined && { signal }),
  };

  return apiClient.request<T>(axiosConfig).then((response) => response.data);
};

export default customFetcher;
