import { useState } from 'react';
import {
  useCalendarSubscriptionQuery,
  useCreateCalendarSubscription,
  useRevokeCalendarSubscription,
  type CalendarSubscriptionSecret,
} from '../../hooks/queries/useCalendarSubscriptionQueries';
import { useToastStore } from '../../stores/useToastStore';
import SettingsRow from './SettingsRow';

/**
 * Calendar subscription URL for the Settings page.
 *
 * The URL is the credential — a calendar app cannot send an auth header — so it
 * is shown exactly once, when it is issued. Afterwards the server only holds a
 * hash and this card can report that a subscription exists, but not what it is.
 */
export default function CalendarSubscriptionCard() {
  const addToast = useToastStore((s) => s.addToast);
  const { data: subscription, isLoading } = useCalendarSubscriptionQuery();
  const createMutation = useCreateCalendarSubscription();
  const revokeMutation = useRevokeCalendarSubscription();

  const [issued, setIssued] = useState<CalendarSubscriptionSecret | null>(null);
  const busy = createMutation.isPending || revokeMutation.isPending;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast('success', 'Copied');
    } catch {
      addToast('error', 'Could not copy — select the URL and copy it manually');
    }
  };

  const issue = () => {
    createMutation.mutate(undefined, { onSuccess: (data) => setIssued(data) });
  };

  const revoke = () => {
    revokeMutation.mutate(undefined, { onSuccess: () => setIssued(null) });
  };

  const active = subscription?.active ?? false;

  return (
    <div className="cc-settings-section">
      <div className="cc-settings-section__title">Calendar subscription</div>

      <SettingsRow
        label="Subscribe from another calendar"
        sublabel={
          isLoading
            ? 'Checking…'
            : active
              ? subscription?.last_used_at
                ? `Active — last fetched ${new Date(subscription.last_used_at).toLocaleString()}`
                : 'Active — not fetched yet'
              : 'No subscription URL yet'
        }
      >
        <div className="cc-settings-inline-actions">
          <button
            type="button"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            disabled={busy}
            onClick={issue}
          >
            {createMutation.isPending ? 'Working…' : active ? 'Replace URL' : 'Create URL'}
          </button>
          {active && (
            <button
              type="button"
              className="cc-btn cc-btn--danger cc-btn--compact"
              disabled={busy}
              onClick={revoke}
            >
              {revokeMutation.isPending ? 'Revoking…' : 'Revoke'}
            </button>
          )}
        </div>
      </SettingsRow>

      {issued && (
        <>
          <SettingsRow
            label="Subscription URL"
            sublabel="Anyone with this link can read your whole calendar. It is shown only now — copy it before leaving this page."
          >
            <div className="cc-settings-inline-actions">
              <input className="cc-settings-input" readOnly value={issued.url} />
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                onClick={() => copy(issued.url)}
              >
                Copy
              </button>
            </div>
          </SettingsRow>
          <SettingsRow
            label="webcal link"
            sublabel="Apple Calendar and Outlook subscribe from this form instead of downloading a one-off copy."
          >
            <div className="cc-settings-inline-actions">
              <input className="cc-settings-input" readOnly value={issued.webcal_url} />
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                onClick={() => copy(issued.webcal_url)}
              >
                Copy
              </button>
            </div>
          </SettingsRow>
        </>
      )}

      {active && !issued && (
        <div className="cc-settings-hint">
          The existing URL cannot be shown again — the server keeps only a hash of it. Replacing it
          issues a new one and stops the old link working immediately, so any calendar already
          subscribed will need the new URL.
        </div>
      )}
    </div>
  );
}
