import { describe, expect, it, vi } from 'vitest';
import { getStartupDiagnostics, markStartupPhase } from '../startupPerformance';

describe('startup performance milestones', () => {
  it('records each milestone once and publishes browser diagnostics', () => {
    const mark = vi.spyOn(performance, 'mark');

    const first = markStartupPhase('auth_ready');
    const second = markStartupPhase('auth_ready');
    const diagnostics = getStartupDiagnostics();

    expect(second).toBe(first);
    expect(diagnostics.phases.auth_ready).toBe(first);
    expect(window.__CLAWCHAT_STARTUP__?.phases.auth_ready).toBe(first);
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith('clawchat:auth_ready');
  });
});
