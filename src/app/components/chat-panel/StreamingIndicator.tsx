import { translateUi } from '../../i18n';
import { useChatStore } from '../../stores/useChatStore';

export default function StreamingIndicator() {
  const activity = useChatStore((s) => s.streamingActivity);
  return (
    <div className="cc-bubble-row cc-bubble-row--assistant">
      <div className="cc-streaming" role="status">
        <div className="cc-streaming__dot" />
        <div className="cc-streaming__dot" />
        <div className="cc-streaming__dot" />
        {activity && (
          <span className="cc-streaming__activity">
            {translateUi('Using {{label}}…', { label: activity.label })}
          </span>
        )}
      </div>
    </div>
  );
}
