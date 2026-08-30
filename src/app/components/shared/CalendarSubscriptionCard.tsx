import { useState } from 'react';
import {
  useCalendarSubscriptionQuery,
  useCreateCalendarSubscription,
  useRevokeCalendarSubscription,
  type CalendarSubscriptionSecret,
} from '../../hooks/queries/useCalendarSubscriptionQueries';
import { useTranslation } from '../../i18n';
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
  const { t, i18n } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: subscription, isLoading } = useCalendarSubscriptionQuery();
  const createMutation = useCreateCalendarSubscription();
  const revokeMutation = useRevokeCalendarSubscription();

  const [issued, setIssued] = useState<CalendarSubscriptionSecret | null>(null);
  const busy = createMutation.isPending || revokeMutation.isPending;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast('success', t('workspaceSettings.calendarSubscription.copied'));
    } catch {
      addToast('error', t('workspaceSettings.calendarSubscription.copyFailed'));
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
      <div className="cc-settings-section__title">
        {t('workspaceSettings.calendarSubscription.title')}
      </div>

      <SettingsRow
        label={t('workspaceSettings.calendarSubscription.subscribe')}
        sublabel={
          isLoading
            ? t('workspaceSettings.calendarSubscription.checking')
            : active
              ? subscription?.last_used_at
                ? t('workspaceSettings.calendarSubscription.activeLastFetched', {
                    date: new Date(subscription.last_used_at).toLocaleString(i18n.language),
                  })
                : t('workspaceSettings.calendarSubscription.activeNotFetched')
              : t('workspaceSettings.calendarSubscription.noUrl')
        }
      >
        <div className="cc-settings-inline-actions">
          <button
            type="button"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            disabled={busy}
            onClick={issue}
          >
            {createMutation.isPending
              ? t('workspaceSettings.actions.working')
              : active
                ? t('workspaceSettings.actions.replaceUrl')
                : t('workspaceSettings.actions.createUrl')}
          </button>
          {active && (
            <button
              type="button"
              className="cc-btn cc-btn--danger cc-btn--compact"
              disabled={busy}
              onClick={revoke}
            >
              {revokeMutation.isPending
                ? t('workspaceSettings.actions.revoking')
                : t('workspaceSettings.actions.revoke')}
            </button>
          )}
        </div>
      </SettingsRow>

      {issued && (
        <>
          <SettingsRow
            label={t('workspaceSettings.calendarSubscription.subscriptionUrl')}
            sublabel={t('workspaceSettings.calendarSubscription.subscriptionWarning')}
          >
            <div className="cc-settings-inline-actions">
              <input className="cc-settings-input" readOnly value={issued.url} />
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                onClick={() => copy(issued.url)}
              >
                {t('workspaceSettings.actions.copy')}
              </button>
            </div>
          </SettingsRow>
          <SettingsRow
            label={t('workspaceSettings.calendarSubscription.webcalLink')}
            sublabel={t('workspaceSettings.calendarSubscription.webcalHint')}
          >
            <div className="cc-settings-inline-actions">
              <input className="cc-settings-input" readOnly value={issued.webcal_url} />
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                onClick={() => copy(issued.webcal_url)}
              >
                {t('workspaceSettings.actions.copy')}
              </button>
            </div>
          </SettingsRow>
        </>
      )}

      {active && !issued && (
        <div className="cc-settings-hint">
          {t('workspaceSettings.calendarSubscription.existingUrlHint')}
        </div>
      )}
    </div>
  );
}
