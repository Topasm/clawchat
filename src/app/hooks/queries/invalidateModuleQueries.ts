import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './index';
import { invalidateTaskDerivedQueries } from './invalidateTaskDerivedQueries';

/**
 * Refresh the caches affected by a server-side module change.
 *
 * Shared by both chat transports: the WebSocket delivers this as a
 * `module_data_changed` event, the SSE stream as a field on its final payload.
 * They must invalidate the same things or the UI goes stale on whichever path
 * the client happens to be using.
 */
export function invalidateModuleQueries(queryClient: QueryClient, module?: string): void {
  const invalidateExecutionTelemetry = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.taskExecutionTelemetry });

  if (module === 'todos') {
    queryClient.invalidateQueries({ queryKey: queryKeys.todos });
    queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
    void invalidateTaskDerivedQueries(queryClient);
    queryClient.invalidateQueries({ queryKey: queryKeys.planProposals });
  } else if (module === 'events') {
    queryClient.invalidateQueries({ queryKey: queryKeys.events });
  } else if (module === 'reviews') {
    queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    invalidateExecutionTelemetry();
  } else if (module === 'artifacts') {
    queryClient.invalidateQueries({ queryKey: ['artifacts'] });
    invalidateExecutionTelemetry();
  } else if (module === 'projects') {
    queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  } else if (module === 'runs') {
    queryClient.invalidateQueries({ queryKey: ['runs'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    invalidateExecutionTelemetry();
  } else {
    // Unknown or absent module — refresh everything the chat can touch.
    queryClient.invalidateQueries({ queryKey: queryKeys.todos });
    queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
    void invalidateTaskDerivedQueries(queryClient);
    queryClient.invalidateQueries({ queryKey: queryKeys.planProposals });
    queryClient.invalidateQueries({ queryKey: queryKeys.events });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
    queryClient.invalidateQueries({ queryKey: ['artifacts'] });
    queryClient.invalidateQueries({ queryKey: ['runs'] });
    invalidateExecutionTelemetry();
  }
  queryClient.invalidateQueries({ queryKey: queryKeys.today });
}
