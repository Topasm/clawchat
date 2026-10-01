import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hideStartupShell, scheduleStartupTimeout, showStartupError } from '../startupSurface';

function mountShell() {
  document.body.innerHTML = `
    <div id="cc-startup-shell" class="cc-startup-shell" role="status" aria-busy="true">
      Loading
    </div>
  `;
}

describe('startup surface', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    mountShell();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('marks the shell idle before fading and removing it', async () => {
    hideStartupShell();
    await vi.advanceTimersByTimeAsync(0);

    const shell = document.getElementById('cc-startup-shell');
    expect(shell).toHaveAttribute('aria-busy', 'false');
    expect(shell).toHaveAttribute('aria-hidden', 'true');
    expect(shell).toHaveClass('cc-startup-shell--hidden');

    await vi.advanceTimersByTimeAsync(200);
    expect(document.getElementById('cc-startup-shell')).toBeNull();
  });

  it('continues hiding across a StrictMode-style effect cleanup', async () => {
    const cleanup = hideStartupShell();
    cleanup();
    hideStartupShell();

    await vi.advanceTimersByTimeAsync(200);

    expect(document.getElementById('cc-startup-shell')).toBeNull();
  });

  it('renders startup failures as text in an assertive alert', () => {
    showStartupError(new Error('<unsafe> Bearer startup-secret /scratch/user/private.md'));

    const alert = document.getElementById('cc-startup-shell');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveAttribute('aria-busy', 'false');
    expect(alert).toHaveTextContent('ClawChat could not start');
    expect(alert).toHaveTextContent('<unsafe>');
    expect(alert).not.toHaveTextContent('startup-secret');
    expect(alert).not.toHaveTextContent('/scratch/user');
    expect(alert).toHaveTextContent('[redacted]');
    expect(alert).toHaveTextContent('[local-path]');
    expect(alert?.querySelector('unsafe')).toBeNull();
  });

  it('surfaces a stalled secure-session hydration', async () => {
    scheduleStartupTimeout(500);
    await vi.advanceTimersByTimeAsync(500);

    expect(document.getElementById('cc-startup-shell')).toHaveAttribute('role', 'alert');
    expect(document.body).toHaveTextContent('Secure session loading took too long');
  });
});
