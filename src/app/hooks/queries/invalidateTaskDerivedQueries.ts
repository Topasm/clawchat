import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

/** Refresh server-derived task views after an authoritative Todo mutation. */
export async function invalidateTaskDerivedQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.taskGraphInsights }),
    queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
  ]);
}
