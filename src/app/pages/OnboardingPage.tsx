import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AiCheckStep, { type AiCheckResult } from '../components/first-run/AiCheckStep';
import ConnectStep from '../components/first-run/ConnectStep';
import ObsidianStep from '../components/first-run/ObsidianStep';
import PhoneStep from '../components/first-run/PhoneStep';
import { SetupStepActions } from '../components/first-run/SetupStepChrome';
import { AI_PROVIDER_LABELS } from '../components/settings/aiProviderStatus';
import { useTheme } from '../config/ThemeContext';
import { themeCssVars } from '../config/themeCssVars';
import { translateUi } from '../i18n';
import { useAuthStore } from '../stores/useAuthStore';
import { useFirstRunStore, type FirstRunOutcome } from '../stores/useFirstRunStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useHostSessionStore } from '../stores/useHostSessionStore';
import { LOCAL_WORKSPACE_ID, useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useWorkspaceRuntimeStore } from '../stores/useWorkspaceRuntimeStore';
import { IS_DESKTOP } from '../types/platform';

type StepId = 'connect' | 'ai' | 'obsidian' | 'phone' | 'done';

const STEPS: StepId[] = ['connect', 'ai', 'obsidian', 'phone', 'done'];

function stepLabel(step: StepId): string {
  switch (step) {
    case 'connect':
      return translateUi('Server');
    case 'ai':
      return translateUi('AI');
    case 'obsidian':
      return translateUi('Obsidian');
    case 'phone':
      return translateUi('Phone');
    case 'done':
      return translateUi('Done');
  }
}

/**
 * First-run setup: where the server runs, whether its AI answers, the
 * Obsidian vault, and an optional phone.
 *
 * The router shows it on a desktop profile that has not finished or skipped
 * it yet, and Settings opens it again at `/onboarding`.
 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { colors } = useTheme();
  const fontSize = useSettingsStore((state) => state.fontSize);
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/';
  const outcome = useFirstRunStore((state) => state.outcome);
  const begin = useFirstRunStore((state) => state.begin);
  const finish = useFirstRunStore((state) => state.finish);
  const token = useAuthStore((state) => state.token);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const hostPhase = useHostSessionStore((state) => state.phase);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const profiles = useWorkspaceStore((state) => state.profiles);
  const vaultPath = useWorkspaceRuntimeStore((state) => state.config?.obsidianVaultPath ?? '');

  const [step, setStep] = useState<StepId>('connect');
  const [aiResult, setAiResult] = useState<AiCheckResult | null>(null);
  const [phonePaired, setPhonePaired] = useState(false);

  useEffect(() => {
    begin();
  }, [begin]);

  const runsLocally = IS_DESKTOP && activeWorkspaceId === LOCAL_WORKSPACE_ID;
  const signedIn = !!token && (!runsLocally || hostPhase === 'connected');
  const activeProfile = profiles.find((profile) => profile.id === activeWorkspaceId);
  const connectedTo = !signedIn
    ? null
    : runsLocally
      ? translateUi('This computer')
      : (activeProfile?.name ?? serverUrl);

  const index = STEPS.indexOf(step);
  const goTo = (offset: number) => setStep(STEPS[index + offset] ?? step);
  const next = () => goTo(1);
  const back = () => goTo(-1);

  const leave = (result: FirstRunOutcome) => {
    // Closing a wizard reopened from Settings must not turn a finished setup
    // into a skipped one.
    if (outcome === null || result === 'completed') finish(result);
    navigate(returnTo, { replace: true });
  };

  const renderStep = () => {
    switch (step) {
      case 'connect':
        return <ConnectStep connectedTo={connectedTo} onNext={next} />;
      case 'ai':
        return (
          <AiCheckStep
            signedIn={signedIn}
            result={aiResult}
            onResult={setAiResult}
            onBack={back}
            onNext={next}
          />
        );
      case 'obsidian':
        return (
          <ObsidianStep
            runsLocally={runsLocally}
            serverName={connectedTo}
            onBack={back}
            onNext={next}
          />
        );
      case 'phone':
        return (
          <PhoneStep
            signedIn={signedIn}
            runsLocally={runsLocally}
            paired={phonePaired}
            onPaired={() => setPhonePaired(true)}
            onBack={back}
            onNext={next}
          />
        );
      case 'done':
        return (
          <div className="cc-onboarding__card">
            <h2 className="cc-onboarding__card-title">{translateUi('ClawChat is ready')}</h2>
            <dl className="cc-onboarding__summary">
              <dt>{translateUi('Server')}</dt>
              <dd>{connectedTo ?? translateUi('Not connected')}</dd>
              <dt>{translateUi('AI')}</dt>
              <dd>
                {aiResult?.kind === 'pass'
                  ? translateUi('{{provider}} is working', {
                      provider: AI_PROVIDER_LABELS[aiResult.provider] ?? aiResult.provider,
                    })
                  : aiResult?.kind === 'fail'
                    ? translateUi('{{provider}} is not working', {
                        provider: AI_PROVIDER_LABELS[aiResult.provider] ?? aiResult.provider,
                      })
                    : translateUi('Not tested')}
              </dd>
              <dt>{translateUi('Obsidian')}</dt>
              <dd>
                {runsLocally
                  ? vaultPath || translateUi('No vault selected')
                  : translateUi('Set on the server')}
              </dd>
              <dt>{translateUi('Phone')}</dt>
              <dd>{phonePaired ? translateUi('Phone paired') : translateUi('Not paired')}</dd>
            </dl>
            <p className="cc-onboarding__card-description">
              {translateUi('You can run this setup again from Settings → General.')}
            </p>
            <SetupStepActions
              onBack={back}
              onNext={() => leave('completed')}
              nextLabel={translateUi('Open ClawChat')}
            />
          </div>
        );
    }
  };

  return (
    // Outside the app layout, so the theme variables have to be applied here.
    <div className="cc-onboarding" style={themeCssVars(colors, fontSize)}>
      <div className="cc-onboarding__container">
        <div className="cc-onboarding__header">
          <span className="cc-onboarding__eyebrow">{translateUi('Set up ClawChat')}</span>
          <button
            type="button"
            className="cc-btn cc-btn--ghost cc-btn--compact"
            onClick={() => leave('skipped')}
          >
            {outcome === null ? translateUi('Skip setup') : translateUi('Close')}
          </button>
        </div>
        <ol className="cc-onboarding__stepper" aria-label={translateUi('Setup steps')}>
          {STEPS.map((candidate, position) => (
            <li
              key={candidate}
              className={`cc-onboarding__step${
                position === index
                  ? ' cc-onboarding__step--active'
                  : position < index
                    ? ' cc-onboarding__step--completed'
                    : ''
              }`}
              aria-current={position === index ? 'step' : undefined}
            >
              <span className="cc-onboarding__step-dot">
                {position < index ? '✓' : position + 1}
              </span>
              <span className="cc-onboarding__step-label">{stepLabel(candidate)}</span>
            </li>
          ))}
        </ol>
        {renderStep()}
      </div>
    </div>
  );
}
