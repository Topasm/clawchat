import { useState, useEffect } from 'react';
import Dialog from './Dialog';
import Toggle from './Toggle';
import RecurrenceSelector from './RecurrenceSelector';
import { useCreateEvent } from '../../hooks/queries';
import type { EventCreate } from '../../types/api';
import { translateUi } from '../../i18n';
interface EventCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the start date (ISO string or YYYY-MM-DD). */
  initialDate?: string;
  /** Pre-fill the start time (HH:MM, 24h). */
  initialTime?: string;
}
const REMINDER_OPTIONS = [
  { label: 'None', value: '' },
  { label: '5 minutes before', value: '5' },
  { label: '15 minutes before', value: '15' },
  { label: '30 minutes before', value: '30' },
  { label: '1 hour before', value: '60' },
  { label: '1 day before', value: '1440' },
];
function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
export default function EventCreateDialog({
  open,
  onOpenChange,
  initialDate,
  initialTime,
}: EventCreateDialogProps) {
  const createEvent = useCreateEvent();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [reminder, setReminder] = useState('');
  const [recurrenceRule, setRecurrenceRule] = useState<string | undefined>();
  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTitle('');
      setDate(initialDate ? initialDate.slice(0, 10) : toLocalDateStr(new Date()));
      setStartTime(initialTime ?? '09:00');
      // Default end time is 1 hour after start
      if (initialTime) {
        const [h, m] = initialTime.split(':').map(Number);
        const endH = Math.min(h + 1, 23);
        setEndTime(`${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      } else {
        setEndTime('10:00');
      }
      setIsAllDay(false);
      setLocation('');
      setDescription('');
      setTagsInput('');
      setReminder('');
      setRecurrenceRule(undefined);
    }
  }, [open, initialDate, initialTime]);
  const handleSave = () => {
    if (!title.trim() || createEvent.isPending) return;
    let startIso: string;
    let endIso: string | undefined;
    if (isAllDay) {
      // All-day events: set to midnight of that day
      startIso = new Date(`${date}T00:00:00`).toISOString();
      endIso = undefined;
    } else {
      startIso = new Date(`${date}T${startTime}:00`).toISOString();
      endIso = new Date(`${date}T${endTime}:00`).toISOString();
    }
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const payload: EventCreate = {
      title: title.trim(),
      description: description.trim() || undefined,
      start_time: startIso,
      end_time: endIso,
      location: location.trim() || undefined,
      is_all_day: isAllDay || undefined,
      reminder_minutes: reminder ? Number(reminder) : undefined,
      recurrence_rule: recurrenceRule || undefined,
      tags: tags.length > 0 ? tags : undefined,
    };
    // The dialog only closes once the server has the event; useCreateEvent
    // reports both the success toast and any failure.
    createEvent.mutate(payload, { onSuccess: () => onOpenChange(false) });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={translateUi('New Event')}
      className="cc-event-dialog"
    >
      <div className="cc-event-form">
        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-title">
            {translateUi('\n            Title\n          ')}
          </label>
          <input
            id="evt-title"
            className="cc-event-form__input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={translateUi('Event title')}
            autoFocus
          />
        </div>

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-date">
            {translateUi('\n            Date\n          ')}
          </label>
          <input
            id="evt-date"
            className="cc-event-form__input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="cc-event-form__row">
          <span className="cc-event-form__label">{translateUi('All day')}</span>
          <Toggle checked={isAllDay} onChange={setIsAllDay} />
        </div>

        {!isAllDay && (
          <div className="cc-event-form__time-row">
            <div className="cc-event-form__field cc-event-form__field--half">
              <label className="cc-event-form__label" htmlFor="evt-start">
                {translateUi('\n                Start time\n              ')}
              </label>
              <input
                id="evt-start"
                className="cc-event-form__input"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="cc-event-form__field cc-event-form__field--half">
              <label className="cc-event-form__label" htmlFor="evt-end">
                {translateUi('\n                End time\n              ')}
              </label>
              <input
                id="evt-end"
                className="cc-event-form__input"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-location">
            {translateUi('\n            Location\n          ')}
          </label>
          <input
            id="evt-location"
            className="cc-event-form__input"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={translateUi('Add location (optional)')}
          />
        </div>

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-desc">
            {translateUi('\n            Description\n          ')}
          </label>
          <textarea
            id="evt-desc"
            className="cc-event-form__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={translateUi('Add description (optional)')}
            rows={3}
          />
        </div>

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-tags">
            {translateUi('\n            Tags\n          ')}
          </label>
          <input
            id="evt-tags"
            className="cc-event-form__input"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder={translateUi('Comma-separated tags (optional)')}
          />
        </div>

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-reminder">
            {translateUi('\n            Reminder\n          ')}
          </label>
          <select
            id="evt-reminder"
            className="cc-event-form__select"
            value={reminder}
            onChange={(e) => setReminder(e.target.value)}
          >
            {REMINDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {translateUi(opt.label)}
              </option>
            ))}
          </select>
        </div>

        <RecurrenceSelector value={recurrenceRule} onChange={setRecurrenceRule} />

        <div className="cc-dialog__actions">
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onOpenChange(false)}
          >
            {translateUi('\n            Cancel\n          ')}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={!title.trim() || createEvent.isPending}
            onClick={handleSave}
          >
            {createEvent.isPending ? translateUi('Saving...') : translateUi('Save')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
