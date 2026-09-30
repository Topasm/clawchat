import { useState } from 'react';
import {
  useCalendarAccountsQuery,
  useConnectCalendarAccount,
  useDeleteCalendarAccount,
  useSyncCalendarAccount,
  useUpdateCalendarSource,
} from '../../hooks/queries';
import { translateUi, useTranslation } from '../../i18n';
import type { CalendarAccount } from '../../types/schemas';
import { formatDateTime } from '../../utils/formatters';
import SettingsRow from '../shared/SettingsRow';
import SettingsSection from '../shared/SettingsSection';

interface Preset {
  id: string;
  label: string;
  url: string;
  hint: string;
}

const PRESETS: Preset[] = [
  {
    id: 'icloud',
    label: 'iCloud',
    url: 'https://caldav.icloud.com/',
    hint: 'Use your Apple ID email and an app-specific password from account.apple.com.',
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    url: 'https://caldav.fastmail.com/',
    hint: 'Use your Fastmail address and an app password with calendar access.',
  },
  {
    id: 'nextcloud',
    label: 'Nextcloud',
    url: 'https://cloud.example.com/remote.php/dav/',
    hint: 'Replace the host with yours and use an app password from Settings > Security.',
  },
  {
    id: 'other',
    label: 'Other CalDAV server',
    url: '',
    hint: 'Any CalDAV server address, such as Radicale or Baikal.',
  },
];

function AccountBlock({ account }: { account: CalendarAccount }) {
  const sync = useSyncCalendarAccount();
  const remove = useDeleteCalendarAccount();
  const update = useUpdateCalendarSource();

  return (
    <li className="cc-calendar-sync__server">
      <div className="cc-calendar-sync__server-head">
        <strong>{account.label}</strong>
        <span className="cc-calendar-sync__note">{account.username}</span>
      </div>
      <span className="cc-calendar-sync__note">
        {account.last_sync_at
          ? translateUi('Last synced {{time}}', { time: formatDateTime(account.last_sync_at) })
          : translateUi('Not synced yet')}
      </span>
      {account.last_error && <p className="cc-calendar-sync__error">{account.last_error}</p>}
      <ul className="cc-calendar-sync__calendars">
        {account.calendars.map((calendar) => (
          <li key={calendar.id}>
            <label className="cc-calendar-sync__toggle">
              <input
                type="checkbox"
                checked={calendar.import_enabled}
                onChange={(event) =>
                  update.mutate({
                    id: calendar.id,
                    changes: { import_enabled: event.target.checked },
                  })
                }
              />
              <span
                className="cc-calendar-sync__swatch"
                style={{ background: calendar.color ?? 'var(--cc-text-tertiary)' }}
                aria-hidden="true"
              />
              <span>{calendar.display_name}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="cc-settings-inline-actions">
        <button
          type="button"
          className="cc-btn cc-btn--compact"
          disabled={sync.isPending}
          onClick={() => sync.mutate(account.id)}
        >
          {sync.isPending ? translateUi('Syncing…') : translateUi('Sync now')}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--danger cc-btn--compact"
          disabled={remove.isPending}
          onClick={() => remove.mutate(account.id)}
        >
          {translateUi('Remove')}
        </button>
      </div>
    </li>
  );
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const connect = useConnectCalendarAccount();
  const [presetId, setPresetId] = useState('icloud');
  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0];
  const [url, setUrl] = useState(preset.url);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const ready = /^https?:\/\/\S+$/.test(url.trim()) && username.trim() && password;

  return (
    <form
      className="cc-calendar-sync__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        connect.mutate(
          {
            label: presetId === 'other' ? '' : preset.label,
            server_url: url.trim(),
            username: username.trim(),
            password,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <div className="cc-settings-inline-actions">
        <select
          className="cc-settings-input"
          aria-label={translateUi('Calendar provider')}
          value={presetId}
          onChange={(event) => {
            const next = PRESETS.find((item) => item.id === event.target.value) ?? PRESETS[0];
            setPresetId(next.id);
            setUrl(next.url);
          }}
        >
          {PRESETS.map((item) => (
            <option key={item.id} value={item.id}>
              {translateUi(item.label)}
            </option>
          ))}
        </select>
      </div>
      <input
        className="cc-settings-input cc-calendar-sync__wide"
        value={url}
        aria-label={translateUi('CalDAV server address')}
        placeholder={translateUi('https://caldav.example.com/')}
        onChange={(event) => setUrl(event.target.value)}
      />
      <div className="cc-settings-inline-actions">
        <input
          className="cc-settings-input"
          value={username}
          autoComplete="username"
          aria-label={translateUi('Username')}
          placeholder={translateUi('Username')}
          onChange={(event) => setUsername(event.target.value)}
        />
        <input
          className="cc-settings-input"
          type="password"
          value={password}
          autoComplete="new-password"
          aria-label={translateUi('App password')}
          placeholder={translateUi('App password')}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <p className="cc-calendar-sync__note">{translateUi(preset.hint)}</p>
      <div className="cc-settings-inline-actions">
        <button type="button" className="cc-btn cc-btn--compact" onClick={onDone}>
          {translateUi('Cancel')}
        </button>
        <button
          type="submit"
          className="cc-btn cc-btn--primary cc-btn--compact"
          disabled={!ready || connect.isPending}
        >
          {connect.isPending ? translateUi('Connecting…') : translateUi('Connect')}
        </button>
      </div>
    </form>
  );
}

/** CalDAV accounts: which calendars to show, and where ClawChat's events go. */
export default function CalendarSyncSettings() {
  const { t } = useTranslation();
  const { data: accounts = [] } = useCalendarAccountsQuery();
  const update = useUpdateCalendarSource();
  const [adding, setAdding] = useState(false);
  const calendars = accounts.flatMap((account) =>
    account.calendars.map((calendar) => ({ ...calendar, account: account.label })),
  );
  const target = calendars.find((calendar) => calendar.is_write_target);

  return (
    <SettingsSection title={t('workspaceSettings.sections.calendarSync')} id="calendar-sync">
      {calendars.length > 0 && (
        <SettingsRow
          label={translateUi('Save ClawChat events to')}
          sublabel={translateUi(
            'Events you create in ClawChat are copied there, and changes made there come back.',
          )}
        >
          <select
            className="cc-settings-input"
            aria-label={translateUi('Save ClawChat events to')}
            value={target?.id ?? ''}
            onChange={(event) => {
              const id = event.target.value;
              if (id) update.mutate({ id, changes: { is_write_target: true } });
              else if (target)
                update.mutate({ id: target.id, changes: { is_write_target: false } });
            }}
          >
            <option value="">{translateUi('Keep them in ClawChat only')}</option>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {`${calendar.account} · ${calendar.display_name}`}
              </option>
            ))}
          </select>
        </SettingsRow>
      )}
      <div className="cc-calendar-sync__block">
        <div className="cc-settings-row__label">{translateUi('Connected calendars')}</div>
        <div className="cc-settings-row__sublabel">
          {translateUi(
            'Checked calendars show in Schedule and count as busy when finding free time. Their events are read-only here.',
          )}
        </div>
        <div className="cc-calendar-sync__stack">
          {accounts.length > 0 && (
            <ul className="cc-calendar-sync__servers">
              {accounts.map((account) => (
                <AccountBlock key={account.id} account={account} />
              ))}
            </ul>
          )}
          {adding ? (
            <ConnectForm onDone={() => setAdding(false)} />
          ) : (
            <div>
              <button
                type="button"
                className="cc-btn cc-btn--compact"
                onClick={() => setAdding(true)}
              >
                {translateUi('Connect a calendar')}
              </button>
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
