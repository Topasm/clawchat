import { translateUi } from '../../i18n';
import { useChatStore } from '../../stores/useChatStore';

/** What the reply is doing while nothing has been written yet, by phase id. */
const PHASE_LABELS: Record<string, string> = {
  intent: 'Reading your message…',
  reply: 'Thinking…',
};

/**
 * The three dots, with a word on what is happening: the phase the server
 * announced, or the tool a reply is using (a Notion search can take a
 * while), so a long wait never looks like nothing.
 */
export default function StreamingIndicator() {
  const activity = useChatStore((s) => s.streamingActivity);
  const label = !activity
    ? null
    : activity.kind === 'phase'
      ? translateUi(PHASE_LABELS[activity.tool] ?? `${activity.label}…`)
      : translateUi('Using {{label}}…', { label: activity.label });
  return (
    <div className="cc-bubble-row cc-bubble-row--assistant">
      <div className="cc-streaming" role="status">
        <div className="cc-streaming__dot" />
        <div className="cc-streaming__dot" />
        <div className="cc-streaming__dot" />
        {label && <span className="cc-streaming__activity">{label}</span>}
      </div>
    </div>
  );
}
