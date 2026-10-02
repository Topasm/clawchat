import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { translateUi, useTranslation } from '../../i18n';
import apiClient from '../../services/apiClient';
import { localTimeZone } from '../../services/jobSchedule';
import { useAuthStore } from '../../stores/useAuthStore';
import { ScheduleSettingsResponseSchema } from '../../types/schemas';
import type { ScheduleSettingsResponse } from '../../types/schemas';
import SettingsRow from '../shared/SettingsRow';
import SettingsSection from '../shared/SettingsSection';
import Toggle from '../shared/Toggle';

type ScheduleUpdate = Partial<
  Pick<
    ScheduleSettingsResponse,
    | 'briefing_enabled'
    | 'briefing_time'
    | 'weekly_review_enabled'
    | 'weekly_review_day'
    | 'weekly_review_time'
    | 'timezone'
  >
>;

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const ENDPOINT = '/settings/schedule';

function weekdayLabel(day: string): string {
  switch (day) {
    case 'monday':
      return translateUi('Monday');
    case 'tuesday':
      return translateUi('Tuesday');
    case 'wednesday':
      return translateUi('Wednesday');
    case 'thursday':
      return translateUi('Thursday');
    case 'friday':
      return translateUi('Friday');
    case 'saturday':
      return translateUi('Saturday');
    default:
      return translateUi('Sunday');
  }
}

function formatNext(iso: string | null | undefined, language: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(language, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** Daily briefing and weekly review: when they run, in which zone. */
export default function ScheduleSettings() {
  const { i18n } = useTranslation();
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const queryClient = useQueryClient();
  const queryKey = ['schedule-settings', serverUrl];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      ScheduleSettingsResponseSchema.parse((await apiClient.get(ENDPOINT, { signal })).data),
    retry: false,
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: async (changes: ScheduleUpdate) =>
      ScheduleSettingsResponseSchema.parse(
        (await apiClient.put(ENDPOINT, changes, { queueOfflineMutation: false })).data,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
    retry: false,
  });

  const plan = query.data;
  const busy = query.isLoading || save.isPending;
  const deviceZone = localTimeZone();
  const zoneDiffers = Boolean(plan && plan.effective_timezone !== deviceZone);
  const nextBriefing = formatNext(plan?.next_briefing_at, i18n.language);
  const nextReview = formatNext(plan?.next_weekly_review_at, i18n.language);

  return (
    <SettingsSection title={translateUi('Briefings')}>
      <SettingsRow
        label={translateUi('Daily briefing')}
        sublabel={
          plan?.briefing_enabled && nextBriefing
            ? translateUi('Next: {{when}}', { when: nextBriefing })
            : translateUi('A morning summary of what is due today, delivered to chat.')
        }
      >
        <div className="cc-settings-inline-actions">
          <input
            className="cc-settings-input cc-settings-input--compact"
            type="time"
            aria-label={translateUi('Briefing time')}
            value={plan?.briefing_time ?? ''}
            disabled={busy || !plan?.briefing_enabled}
            onChange={(event) => {
              const value = event.target.value;
              if (/^\d{2}:\d{2}$/.test(value)) save.mutate({ briefing_time: value });
            }}
          />
          <Toggle
            label={translateUi('Daily briefing')}
            checked={Boolean(plan?.briefing_enabled)}
            disabled={busy}
            onChange={(checked) => save.mutate({ briefing_enabled: checked })}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        label={translateUi('Weekly review')}
        sublabel={
          plan?.weekly_review_enabled && nextReview
            ? translateUi('Next: {{when}}', { when: nextReview })
            : translateUi('A look back at the week and what to carry forward.')
        }
      >
        <div className="cc-settings-inline-actions">
          <select
            className="cc-settings-input cc-settings-input--compact"
            aria-label={translateUi('Review day')}
            value={plan?.weekly_review_day ?? 'sunday'}
            disabled={busy || !plan?.weekly_review_enabled}
            onChange={(event) => save.mutate({ weekly_review_day: event.target.value })}
          >
            {WEEKDAYS.map((day) => (
              <option key={day} value={day}>
                {weekdayLabel(day)}
              </option>
            ))}
          </select>
          <input
            className="cc-settings-input cc-settings-input--compact"
            type="time"
            aria-label={translateUi('Review time')}
            value={plan?.weekly_review_time ?? ''}
            disabled={busy || !plan?.weekly_review_enabled}
            onChange={(event) => {
              const value = event.target.value;
              if (/^\d{2}:\d{2}$/.test(value)) save.mutate({ weekly_review_time: value });
            }}
          />
          <Toggle
            label={translateUi('Weekly review')}
            checked={Boolean(plan?.weekly_review_enabled)}
            disabled={busy}
            onChange={(checked) => save.mutate({ weekly_review_enabled: checked })}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        label={translateUi('Time zone')}
        sublabel={
          plan
            ? plan.timezone
              ? translateUi('Times above are read in {{zone}}.', { zone: plan.effective_timezone })
              : translateUi("Times above are read in the server's zone, {{zone}}.", {
                  zone: plan.effective_timezone,
                })
            : undefined
        }
      >
        {zoneDiffers ? (
          <button
            type="button"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            disabled={busy}
            onClick={() => save.mutate({ timezone: deviceZone })}
          >
            {translateUi('Use {{zone}}', { zone: deviceZone })}
          </button>
        ) : (
          <span className="cc-settings-row__value">{plan?.effective_timezone ?? '…'}</span>
        )}
      </SettingsRow>

      {query.isError && (
        <p className="cc-settings-hint">{translateUi('Could not load the briefing schedule.')}</p>
      )}
      {save.isError && (
        <p className="cc-settings-hint">{translateUi('Could not save the schedule.')}</p>
      )}
    </SettingsSection>
  );
}
