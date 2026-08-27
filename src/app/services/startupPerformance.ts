export type StartupPhase =
  | 'renderer_module_loaded'
  | 'react_root_committed'
  | 'auth_ready'
  | 'route_ready'
  | 'startup_shell_hidden'
  | 'platform_ready'
  | 'transport_ready'
  | 'startup_error';

interface StartupDiagnostics {
  startedAt: number;
  phases: Partial<Record<StartupPhase, number>>;
}

declare global {
  interface Window {
    __CLAWCHAT_STARTUP__?: StartupDiagnostics;
  }
}

const startedAt = performance.now();
const phases: Partial<Record<StartupPhase, number>> = {};

function publishDiagnostics(): void {
  window.__CLAWCHAT_STARTUP__ = {
    startedAt,
    phases: { ...phases },
  };
}

export function markStartupPhase(phase: StartupPhase): number {
  const existing = phases[phase];
  if (existing !== undefined) return existing;

  const elapsed = Math.round((performance.now() - startedAt) * 10) / 10;
  phases[phase] = elapsed;
  try {
    performance.mark(`clawchat:${phase}`);
  } catch {
    // User Timing may be unavailable in restricted webviews.
  }
  publishDiagnostics();
  return elapsed;
}

export function markStartupPhaseAfterPaint(phase: StartupPhase): () => void {
  const frame = window.requestAnimationFrame(() => markStartupPhase(phase));
  return () => window.cancelAnimationFrame(frame);
}

export function getStartupDiagnostics(): StartupDiagnostics {
  return {
    startedAt,
    phases: { ...phases },
  };
}

publishDiagnostics();
