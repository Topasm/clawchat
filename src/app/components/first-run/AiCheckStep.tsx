import { useCallback, useEffect, useState } from 'react';
import { translateUi, useTranslation } from '../../i18n';
import apiClient from '../../services/apiClient';
import SegmentedControl from '../shared/SegmentedControl';
import {
  AI_PROVIDER_LABELS,
  aiProviderErrorMessage,
  providerStatusLabel,
  type AIProviderState,
} from '../settings/aiProviderStatus';
import { SetupStatus, SetupStepActions } from './SetupStepChrome';

export type AiCheckResult =
  | { kind: 'pass'; provider: string; latencyMs: number | null }
  | { kind: 'fail'; provider: string; message: string };

interface AITestResponse {
  connected: boolean;
  latency_ms: number | null;
  error: string | null;
}

const PROVIDERS = ['openclaw', 'claude_code', 'codex_cli', 'codex'] as const;

function providerStatus(state: AIProviderState, provider: string): string {
  switch (provider) {
    case 'openclaw':
      return state.openclaw_connected ? 'available' : 'unavailable';
    case 'claude_code':
      return state.claude_code_status;
    case 'codex_cli':
      return state.codex_cli_status;
    case 'codex':
      return state.codex_api_status;
    default:
      return 'unavailable';
  }
}

function failureHint(provider: string): string {
  switch (provider) {
    case 'claude_code':
      return translateUi(
        'Install Claude Code on the server machine and run claude login there, then test again.',
      );
    case 'codex_cli':
      return translateUi(
        'Install the Codex CLI on the server machine and run codex login there, then test again.',
      );
    case 'codex':
      return translateUi('Add a Codex API key in workspace settings, then test again.');
    default:
      return translateUi(
        'Check that Ollama or your OpenAI-compatible server is running at the address in AI_BASE_URL.',
      );
  }
}

/**
 * Step 2: pick the server's AI provider and prove that it answers, using the
 * same `/admin/ai/...` endpoints as workspace settings.
 */
export default function AiCheckStep({
  signedIn,
  result,
  onResult,
  onBack,
  onNext,
}: {
  signedIn: boolean;
  result: AiCheckResult | null;
  onResult: (result: AiCheckResult | null) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const [providerState, setProviderState] = useState<AIProviderState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [provider, setProvider] = useState<string>('');
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await apiClient.get<AIProviderState>('/admin/ai/provider');
      setProviderState(response.data);
      setProvider((current) => current || response.data.active_provider);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [load, signedIn]);

  const testConnection = async () => {
    if (!providerState || !provider) return;
    setTesting(true);
    onResult(null);
    try {
      if (provider !== providerState.active_provider) {
        try {
          const switched = await apiClient.post<AIProviderState>(
            '/admin/ai/provider',
            { provider },
            { queueOfflineMutation: false },
          );
          setProviderState(switched.data);
        } catch (error) {
          onResult({
            kind: 'fail',
            provider,
            message: aiProviderErrorMessage(error, t, 'workspaceSettings.ai.failedSwitch'),
          });
          return;
        }
      }
      try {
        const response = await apiClient.post<AITestResponse>('/admin/ai/test', undefined, {
          queueOfflineMutation: false,
        });
        onResult(
          response.data.connected
            ? { kind: 'pass', provider, latencyMs: response.data.latency_ms }
            : {
                kind: 'fail',
                provider,
                message: response.data.error || translateUi('The provider did not answer.'),
              },
        );
      } catch (error) {
        onResult({
          kind: 'fail',
          provider,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const label = (value: string) => AI_PROVIDER_LABELS[value] ?? value;

  return (
    <div className="cc-onboarding__card">
      <h2 className="cc-onboarding__card-title">{translateUi('Test the AI connection')}</h2>
      <p className="cc-onboarding__card-description">
        {translateUi(
          'Choose which AI the server uses for chat and agents, then check that it answers. Tasks, calendar and notes work without AI.',
        )}
      </p>

      {!signedIn ? (
        <SetupStatus tone="idle" label={translateUi('Connect to a server first to test its AI.')} />
      ) : loadFailed ? (
        <>
          <SetupStatus tone="fail" label={translateUi('Could not read the AI settings.')} />
          <button type="button" className="cc-btn cc-btn--secondary" onClick={() => void load()}>
            {translateUi('Retry')}
          </button>
        </>
      ) : !providerState ? (
        <SetupStatus tone="busy" label={translateUi('Checking AI providers…')} />
      ) : (
        <>
          <div className="cc-onboarding__input-group">
            <span className="cc-onboarding__input-label">{translateUi('AI provider')}</span>
            <SegmentedControl
              ariaLabel={translateUi('AI provider')}
              options={PROVIDERS.map((value) => ({ label: label(value), value }))}
              value={provider}
              onChange={(value) => {
                setProvider(value);
                onResult(null);
              }}
            />
            <span className="cc-onboarding__input-hint">
              {providerStatusLabel(providerStatus(providerState, provider), t)}
            </span>
          </div>
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            disabled={testing}
            onClick={() => void testConnection()}
          >
            {testing ? translateUi('Testing…') : translateUi('Test connection')}
          </button>
          {result?.kind === 'pass' && result.provider === provider && (
            <SetupStatus
              tone="pass"
              label={translateUi('{{provider}} is working', { provider: label(provider) })}
              detail={
                result.latencyMs !== null
                  ? translateUi('Answered in {{ms}} ms', { ms: Math.round(result.latencyMs) })
                  : undefined
              }
            />
          )}
          {result?.kind === 'fail' && result.provider === provider && (
            <SetupStatus
              tone="fail"
              label={translateUi('{{provider}} is not working', { provider: label(provider) })}
              detail={
                <>
                  {result.message}
                  <br />
                  {failureHint(provider)}
                </>
              }
            />
          )}
        </>
      )}

      <SetupStepActions
        onBack={onBack}
        onNext={onNext}
        onSkipStep={result?.kind === 'pass' ? undefined : onNext}
        nextDisabled={result?.kind !== 'pass'}
      />
    </div>
  );
}
