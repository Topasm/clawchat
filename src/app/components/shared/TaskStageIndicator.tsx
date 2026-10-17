import { CheckIcon } from './Icons';
import {
  TASK_STAGES,
  describeTaskStage,
  taskStageExceptionLabel,
  taskStageLabel,
} from '../../utils/taskStage';
import type { TaskStageState } from '../../utils/taskStage';
import { translateUi } from '../../i18n';

interface TaskStageIndicatorProps {
  state: TaskStageState;
  /** `dots` for a list row (five marks and one word), `bar` for a task or run page. */
  variant?: 'dots' | 'bar';
  /** Replaces the step's own word in the dots variant, e.g. "Blocked". */
  label?: string;
  /** Dots variant: draw the five marks. Off for a task no agent is on. */
  marks?: boolean;
}

/**
 * Where a task is among Captured → Plan → Run → Review → Done.
 *
 * Only the current step carries the accent; a step behind it is plain, a
 * step ahead is hollow. Needing an answer or having failed sits on the
 * current step as a badge instead of becoming a sixth step.
 */
export default function TaskStageIndicator({
  state,
  variant = 'dots',
  label,
  marks = true,
}: TaskStageIndicatorProps) {
  const current = TASK_STAGES.indexOf(state.stage);
  const tone = state.cancelled ? 'cancelled' : (state.exception ?? 'current');
  const summary = translateUi('Step {{step}} of 5: {{label}}', {
    step: current + 1,
    label: describeTaskStage(state),
  });
  if (variant === 'dots') {
    return (
      <span className={`cc-stage-dots cc-stage-dots--${tone}`} title={summary}>
        {marks && (
          <span className="cc-stage-dots__marks" aria-hidden="true">
            {TASK_STAGES.map((stage, index) => (
              <i
                key={stage}
                className={`cc-stage-dots__mark cc-stage-dots__mark--${
                  index < current ? 'past' : index === current ? 'current' : 'next'
                }`}
              />
            ))}
          </span>
        )}
        <span className="cc-stage-dots__label">{label ?? describeTaskStage(state)}</span>
      </span>
    );
  }
  return (
    <ol className={`cc-stage-bar cc-stage-bar--${tone}`} aria-label={summary}>
      {TASK_STAGES.map((stage, index) => {
        const position = index < current ? 'past' : index === current ? 'current' : 'next';
        return (
          <li
            key={stage}
            className={`cc-stage-bar__step cc-stage-bar__step--${position}`}
            aria-current={position === 'current' ? 'step' : undefined}
          >
            <span className="cc-stage-bar__mark" aria-hidden="true">
              {position === 'past' || (position === 'current' && stage === 'done') ? (
                <CheckIcon size={12} />
              ) : (
                index + 1
              )}
            </span>
            <span className="cc-stage-bar__name">{taskStageLabel(stage)}</span>
            {position === 'current' && state.exception && (
              <span className={`cc-stage-bar__badge cc-stage-bar__badge--${state.exception}`}>
                {taskStageExceptionLabel(state.exception)}
              </span>
            )}
            {position === 'current' && state.cancelled && (
              <span className="cc-stage-bar__badge">{translateUi('Cancelled')}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
