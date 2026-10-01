import { logger } from './logger';
import { redactSensitiveText } from './sensitiveData';
import { markStartupPhase } from './startupPerformance';

const STARTUP_SHELL_ID = 'cc-startup-shell';
const STARTUP_HIDE_FALLBACK_MS = 200;
let globalErrorHandlersInstalled = false;

export function hideStartupShell(): () => void {
  const shell = document.getElementById(STARTUP_SHELL_ID);
  if (!shell) return () => undefined;
  if (shell.dataset.ccHiding === 'true') return () => undefined;
  shell.dataset.ccHiding = 'true';

  window.requestAnimationFrame(() => {
    shell.setAttribute('aria-busy', 'false');
    shell.setAttribute('aria-hidden', 'true');
    shell.classList.add('cc-startup-shell--hidden');

    const removeShell = () => {
      shell.remove();
      markStartupPhase('startup_shell_hidden');
    };
    shell.addEventListener('transitionend', removeShell, { once: true });
    window.setTimeout(removeShell, STARTUP_HIDE_FALLBACK_MS);
  });

  // Hiding is intentionally irreversible. React StrictMode runs effect cleanup
  // immediately during its development probe; cancelling here would leave the
  // standalone HTML shell permanently covering the mounted application.
  return () => undefined;
}

export function showStartupError(error: unknown): void {
  const shell = document.getElementById(STARTUP_SHELL_ID);
  if (!shell) return;

  markStartupPhase('startup_error');
  const rawDetail = error instanceof Error ? error.message : String(error);
  const detail = import.meta.env.DEV
    ? redactSensitiveText(rawDetail)
    : 'Review the local diagnostic log, then restart the app.';
  const title = document.createElement('strong');
  const message = document.createElement('span');
  title.textContent = 'ClawChat could not start';
  message.textContent = detail;

  shell.className = 'cc-startup-shell cc-startup-shell--error';
  shell.setAttribute('role', 'alert');
  shell.setAttribute('aria-live', 'assertive');
  shell.setAttribute('aria-busy', 'false');
  shell.removeAttribute('aria-hidden');
  shell.replaceChildren(title, message);
}

export function scheduleStartupTimeout(timeoutMs = 10_000): () => void {
  const timer = window.setTimeout(() => {
    if (!document.getElementById(STARTUP_SHELL_ID)) return;
    showStartupError(new Error('Secure session loading took too long. Restart the app to retry.'));
  }, timeoutMs);

  return () => window.clearTimeout(timer);
}

export function installGlobalErrorHandlers(): void {
  if (globalErrorHandlersInstalled) return;
  globalErrorHandlersInstalled = true;

  window.addEventListener('error', (event) => {
    const error = event.error ?? new Error(event.message || 'Unknown window error');
    logger.error('Uncaught window error', error, {
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
    if (document.getElementById(STARTUP_SHELL_ID)) showStartupError(error);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason ?? 'Unhandled promise rejection'));
    logger.error('Unhandled promise rejection', error);
    if (document.getElementById(STARTUP_SHELL_ID)) showStartupError(error);
  });
}
