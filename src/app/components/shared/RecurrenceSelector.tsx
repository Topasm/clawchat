import { useState, useEffect } from 'react';

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
  const [count, setCount] = useState(10);

  // Parse incoming value on mount
  useEffect(() => {
    if (!value) {
      setFreq('none');
      return;
    }
    const rule = value.replace('RRULE:', '');
    const params = Object.fromEntries(rule.split(';').map((p) => p.split('=')));
    if (params.FREQ) setFreq(params.FREQ as Frequency);
    if (params.BYDAY) setByDay(params.BYDAY.split(','));
    if (params.COUNT) {
      setEndsType('after_count');
      setCount(Number(params.COUNT));
    } else if (params.UNTIL) {
      setEndsType('on_date');
    } else {
      setEndsType('never');
    }
  }, []); // Only parse on mount

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
        <label className="cc-event-form__label">Repeat</label>
        <select
          className="cc-event-form__select"
          value={freq}
          onChange={(e) => handleFreqChange(e.target.value as Frequency)}
        >
          <option value="none">None</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
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
              {d.label}
            </button>
          ))}
        </div>
      )}

      {freq !== 'none' && (
        <div className="cc-recurrence__ends">
          <label className="cc-event-form__label">Ends</label>
          <select
            className="cc-event-form__select"
            value={endsType}
            onChange={(e) => handleEndsChange(e.target.value as EndsType)}
          >
            <option value="never">Never</option>
            <option value="on_date">On date</option>
            <option value="after_count">After N occurrences</option>
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
