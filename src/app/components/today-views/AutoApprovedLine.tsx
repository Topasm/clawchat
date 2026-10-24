import { useNavigate } from 'react-router-dom';
import { useReviewsQuery, useUpdateScheduledJob } from '../../hooks/queries';
import { useOptionalChatPanelController } from '../chat-panel/ChatPanelControllerContext';
import { reviewAutomation } from '../review/ReviewItemCard';
import type { ReviewItemResponse } from '../../types/api';
import { isToday } from '../../utils/formatters';
import { translateUi } from '../../i18n';

/** The results an automation adopted today without asking. */
export function autoApprovedToday(items: ReviewItemResponse[]): ReviewItemResponse[] {
  return items.filter(
    (item) =>
      item.reviewed_at !== null &&
      isToday(item.reviewed_at) &&
      reviewAutomation(item)?.auto_approved === true,
  );
}

/**
 * "Approved without asking · N" on Today: where a skipped review still leaves
 * a trace. "View" opens the result in the AI panel; "Ask next time" turns the
 * automation's skipping off, right here, so there is no other place to look
 * for it. Nothing when nothing was skipped today.
 */
export default function AutoApprovedLine() {
  const navigate = useNavigate();
  const panel = useOptionalChatPanelController();
  const updateJob = useUpdateScheduledJob();
  const { data: approved = [] } = useReviewsQuery('approved');
  const items = autoApprovedToday(approved);
  if (items.length === 0) return null;
  const latest = items[0];
  const automation = reviewAutomation(latest)!;
  const conversationId =
    typeof latest.metadata.conversation_id === 'string' ? latest.metadata.conversation_id : null;
  const view = () => {
    if (conversationId && panel) {
      panel.open(conversationId, {
        kind: 'run',
        title: translateUi('Task Agent'),
        subtitle: latest.subject_title ?? automation.title,
      });
    } else if (conversationId) {
      navigate(`/chats/${conversationId}`);
    } else if (latest.subject_href) {
      navigate(latest.subject_href);
    }
  };
  const titles = Array.from(new Set(items.map((item) => reviewAutomation(item)?.title ?? '')));
  return (
    <div className="cc-today-auto" data-testid="today-auto-approved">
      <span className="cc-today-auto__text">
        {translateUi('Approved without asking · {{count}}', { count: items.length })}
        {' · '}
        {titles.filter(Boolean).join(', ')}
      </span>
      <button type="button" className="cc-today-auto__action" onClick={view}>
        {translateUi('View')}
      </button>
      {automation.auto_approve_low_risk && (
        <button
          type="button"
          className="cc-today-auto__action"
          disabled={updateJob.isPending}
          onClick={() =>
            updateJob.mutate({
              id: automation.scheduled_job_id,
              changes: { auto_approve_low_risk: false },
            })
          }
        >
          {translateUi('Ask next time')}
        </button>
      )}
    </div>
  );
}
