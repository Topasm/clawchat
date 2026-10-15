import type { ReactNode } from 'react';
import { translateUi } from '../../i18n';

export type SetupTone = 'pass' | 'fail' | 'busy' | 'idle';

const DOT_CLASS: Record<SetupTone, string> = {
  pass: 'cc-onboarding__status-dot--green',
  fail: 'cc-onboarding__status-dot--red',
  busy: 'cc-onboarding__status-dot--spin',
  idle: 'cc-onboarding__status-dot--gray',
};

/** One line of state with a coloured dot, shared by every setup step. */
export function SetupStatus({
  tone,
  label,
  detail,
}: {
  tone: SetupTone;
  label: string;
  detail?: ReactNode;
}) {
  return (
    <div
      className={`cc-onboarding__status-row cc-onboarding__status-row--${tone}`}
      role={tone === 'fail' ? 'alert' : 'status'}
    >
      <div className={`cc-onboarding__status-dot ${DOT_CLASS[tone]}`} />
      <div>
        <div className="cc-onboarding__status-label">{label}</div>
        {detail && <div className="cc-onboarding__status-sublabel">{detail}</div>}
      </div>
    </div>
  );
}

/** Back / skip / next row at the bottom of a setup step. */
export function SetupStepActions({
  onBack,
  onNext,
  nextLabel,
  nextDisabled = false,
  onSkipStep,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  onSkipStep?: () => void;
}) {
  return (
    <div className="cc-onboarding__actions">
      {onBack ? (
        <button type="button" className="cc-btn cc-btn--ghost" onClick={onBack}>
          {translateUi('Back')}
        </button>
      ) : (
        <span />
      )}
      <div className="cc-onboarding__actions-right">
        {onSkipStep && (
          <button type="button" className="cc-btn cc-btn--ghost" onClick={onSkipStep}>
            {translateUi('Skip this step')}
          </button>
        )}
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          disabled={nextDisabled}
          onClick={onNext}
        >
          {nextLabel ?? translateUi('Next')}
        </button>
      </div>
    </div>
  );
}
