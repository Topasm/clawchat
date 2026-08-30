import type { HostSessionPhase } from '../stores/useHostSessionStore';

export interface WorkspaceRouteContext {
  token: string | null;
  healthOK: boolean;
  hostPhase: HostSessionPhase;
}

export function isWorkspaceSessionReady(context: WorkspaceRouteContext): boolean {
  return (
    Boolean(context.token) &&
    context.healthOK &&
    (context.hostPhase === 'idle' || context.hostPhase === 'connected')
  );
}

export function resolveNativeSettingsRoute(
  context: WorkspaceRouteContext,
): '/settings/workspace' | '/settings/app' {
  return isWorkspaceSessionReady(context) ? '/settings/workspace' : '/settings/app';
}
