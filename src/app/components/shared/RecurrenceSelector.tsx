import { useState, useEffect } from 'react';
import { translateUi } from '../../i18n';
interface RecurrenceSelectorProps {
  value: string | undefined;
  onChange: (rule: string | undefined) => void;
}
type Frequency = 'none' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
type EndsType = 'never' | 'on_date' | 'after_count';
const WEEKDAYS = [
  { label: 'Su', value: 'SU' },
  { label: 'Mo', value: 'MO' },
  { label: 'Tu', value: 'TU' },
  { label: 'We', value: 'WE' },
  { label: 'Th', value: 'TH' },
  { label: 'Fr', value: 'FR' },
  { label: 'Sa', value: 'SA' },
];
const DEFAULT_COUNT = 10;

interface ParsedRrule {
  freq: Frequency;
  byDay: string[];
  endsType: EndsType;
  endDate: string;
  count: number;
}

function parseUntilDate(value: string | undefined): string {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function parseRrule(value: string | undefined): ParsedRrule {
  if (!value) {
    return { freq: 'none', byDay: [], endsType: 'never', endDate: '', count: DEFAULT_COUNT };
  }

  const rule = value.replace(/^RRULE:/, '');
  const params = Object.fromEntries(
    rule.split(';').map((part) => {
      const separator = part.indexOf('=');
      return separator === -1 ? [part, ''] : [part.slice(0, separator), part.slice(separator + 1)];
    }),
  );
  const freq = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(params.FREQ)
    ? (params.FREQ as Frequency)
    : 'none';
  const endDate = parseUntilDate(params.UNTIL);
  const parsedCount = Number(params.COUNT);

  return {
    freq,
    byDay: params.BYDAY ? params.BYDAY.split(',').filter(Boolean) : [],
    endsType: params.COUNT ? 'after_count' : params.UNTIL ? 'on_date' : 'never',
    endDate,
    count: Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : DEFAULT_COUNT,
  };
}

function buildRrule(
  freq: Frequency,
  byDay: string[],
  endsType: EndsType,
  endDate: string,
  count: number,
): string | undefined {
  if (freq === 'none') return undefined;
  const parts = [`FREQ=${freq}`];
  if (freq === 'WEEKLY' && byDay.length > 0) {
    parts.push(`BYDAY=${byDay.join(',')}`);
  }
  if (endsType === 'on_date' && endDate) {
    const d = new Date(endDate);
    const until = d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    parts.push(`UNTIL=${until}`);
  } else if (endsType === 'after_count' && count > 0) {
    parts.push(`COUNT=${count}`);
  }
  return `RRULE:${parts.join(';')}`;
}
export default function RecurrenceSelector({ value, onChange }: RecurrenceSelectorProps) {
  const [freq, setFreq] = useState<Frequency>('none');
  const [byDay, setByDay] = useState<string[]>([]);
  const [endsType, setEndsType] = useState<EndsType>('never');
  const [endDate, setEndDate] = useState('');
  const [count, setCount] = useState(DEFAULT_COUNT);
  // Keep the editor synchronized when a different task or a refreshed value arrives.
  useEffect(() => {
    const parsed = parseRrule(value);
    setFreq(parsed.freq);
    setByDay(parsed.byDay);
    setEndsType(parsed.endsType);
    setEndDate(parsed.endDate);
    setCount(parsed.count);
  }, [value]);
  const handleFreqChange = (f: Frequency) => {
    setFreq(f);
    if (f === 'none') {
      onChange(undefined);
    } else {
      onChange(buildRrule(f, byDay, endsType, endDate, count));
    }
  };
  const toggleDay = (day: string) => {
    const next = byDay.includes(day) ? byDay.filter((d) => d !== day) : [...byDay, day];
    setByDay(next);
    onChange(buildRrule(freq, next, endsType, endDate, count));
  };
  const handleEndsChange = (type: EndsType) => {
    setEndsType(type);
    onChange(buildRrule(freq, byDay, type, endDate, count));
  };
  const handleEndDateChange = (d: string) => {
    setEndDate(d);
    onChange(buildRrule(freq, byDay, endsType, d, count));
  };
  const handleCountChange = (c: number) => {
    setCount(c);
    onChange(buildRrule(freq, byDay, endsType, endDate, c));
  };
  return (
    <div className="cc-recurrence">
      <div className="cc-event-form__field">
        <label className="cc-event-form__label">{translateUi('Repeat')}</label>
        <select
          className="cc-event-form__select"
          value={freq}
          onChange={(e) => handleFreqChange(e.target.value as Frequency)}
        >
          <option value="none">{translateUi('None')}</option>
          <option value="DAILY">{translateUi('Daily')}</option>
          <option value="WEEKLY">{translateUi('Weekly')}</option>
          <option value="MONTHLY">{translateUi('Monthly')}</option>
          <option value="YEARLY">{translateUi('Yearly')}</option>
        </select>
      </div>

      {freq === 'WEEKLY' && (
        <div className="cc-recurrence__days">
          {WEEKDAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              className={`cc-recurrence__day-btn${byDay.includes(d.value) ? ' cc-recurrence__day-btn--active' : ''}`}
              onClick={() => toggleDay(d.value)}
            >
              {translateUi(d.label)}
            </button>
          ))}
        </div>
      )}

      {freq !== 'none' && (
        <div className="cc-recurrence__ends">
          <label className="cc-event-form__label">{translateUi('Ends')}</label>
          <select
            className="cc-event-form__select"
            value={endsType}
            onChange={(e) => handleEndsChange(e.target.value as EndsType)}
          >
            <option value="never">{translateUi('Never')}</option>
            <option value="on_date">{translateUi('On date')}</option>
            <option value="after_count">{translateUi('After N occurrences')}</option>
          </select>

          {endsType === 'on_date' && (
            <input
              type="date"
              className="cc-event-form__input cc-mt-8"
              value={endDate}
              onChange={(e) => handleEndDateChange(e.target.value)}
            />
          )}

          {endsType === 'after_count' && (
            <input
              type="number"
              className="cc-event-form__input cc-mt-8"
              min={1}
              max={999}
              value={count}
              onChange={(e) => handleCountChange(Number(e.target.value))}
            />
          )}
        </div>
      )}
    </div>
  );
}
