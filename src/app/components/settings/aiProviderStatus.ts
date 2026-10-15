/**
 * Shared wording for the server's AI providers, used by workspace settings
 * and by the first-run setup wizard.
 */
export interface AIProviderState {
  active_provider: string;
  openclaw_connected: boolean;
  claude_code_status: string;
  claude_code_version: string | null;
  codex_cli_status: string;
  codex_cli_version: string | null;
  codex_cli_model: string;
  codex_api_status: string;
  codex_api_configured: boolean;
  codex_api_key_persistent: boolean;
  codex_model: string;
}
export const AI_PROVIDER_LABELS: Record<string, string> = {
  openclaw: 'OpenClaw',
  claude_code: 'Claude Code',
  codex_cli: 'Codex CLI',
  codex: 'Codex API',
};
export type Translate = (key: string, options?: Record<string, string | number>) => string;
const AI_ERROR_TRANSLATIONS: Record<string, string> = {
  invalid_provider: 'workspaceSettings.ai.errors.invalidProvider',
  claude_not_initialized: 'workspaceSettings.ai.errors.claudeNotInitialized',
  claude_unavailable: 'workspaceSettings.ai.errors.claudeUnavailable',
  codex_cli_not_initialized: 'workspaceSettings.ai.errors.codexCliNotInitialized',
  codex_cli_unavailable: 'workspaceSettings.ai.errors.codexCliUnavailable',
  codex_not_initialized: 'workspaceSettings.ai.errors.codexNotInitialized',
  codex_not_configured: 'workspaceSettings.ai.errors.codexNotConfigured',
  codex_authentication_failed: 'workspaceSettings.ai.errors.codexAuthenticationFailed',
  codex_unavailable: 'workspaceSettings.ai.errors.codexUnavailable',
  codex_key_too_short: 'workspaceSettings.ai.errors.codexKeyTooShort',
  codex_model_unavailable: 'workspaceSettings.ai.errors.codexModelUnavailable',
  codex_key_persist_failed: 'workspaceSettings.ai.errors.codexKeyPersistFailed',
};
export function providerStatusLabel(status: string, t: Translate): string {
  switch (status) {
    case 'available':
      return t('workspaceSettings.ai.statusAvailable');
    case 'not_configured':
      return t('workspaceSettings.ai.statusNotConfigured');
    case 'authentication_failed':
      return t('workspaceSettings.ai.statusAuthenticationFailed');
    case 'unavailable':
      return t('workspaceSettings.ai.statusUnavailable');
    case 'not_installed':
      return t('workspaceSettings.ai.claudeNotInstalled');
    case 'not_authenticated':
      return t('workspaceSettings.ai.claudeNotAuthenticated');
    default:
      return status;
  }
}
export function codexStatusLabel(provider: AIProviderState, t: Translate): string {
  switch (provider.codex_api_status) {
    case 'available':
      return t('workspaceSettings.ai.codexReady', { model: provider.codex_model });
    case 'not_configured':
      return t('workspaceSettings.ai.codexNotConfigured');
    case 'authentication_failed':
      return t('workspaceSettings.ai.codexAuthenticationFailed');
    case 'unavailable':
      return t('workspaceSettings.ai.codexUnavailable', { model: provider.codex_model });
    default:
      return t('workspaceSettings.ai.status', { status: provider.codex_api_status });
  }
}
export function aiProviderErrorMessage(error: unknown, t: Translate, fallbackKey: string): string {
  const response = (
    error as {
      response?: {
        data?: {
          error?: {
            details?: {
              reason?: string;
            };
          };
        };
      };
    }
  )?.response;
  const reason = response?.data?.error?.details?.reason;
  const translationKey = reason ? AI_ERROR_TRANSLATIONS[reason] : undefined;
  return t(translationKey ?? fallbackKey);
}
