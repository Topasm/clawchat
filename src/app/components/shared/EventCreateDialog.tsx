import { useState, useEffect } from 'react';
import Dialog from './Dialog';
import Toggle from './Toggle';
import { useModuleStore } from '../../stores/useModuleStore';
import { useToastStore } from '../../stores/useToastStore';

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

function toLocalTimeStr(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

export default function EventCreateDialog({
  open,
  onOpenChange,
  initialDate,
  initialTime,
}: EventCreateDialogProps) {
  const addEvent = useModuleStore((s) => s.addEvent);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [reminder, setReminder] = useState('');

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
    }
  }, [open, initialDate, initialTime]);

  const handleSave = () => {
    if (!title.trim()) return;

    const now = new Date().toISOString();
    const id = `local-${Date.now()}`;

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

    addEvent({
      id,
      title: title.trim(),
      description: description.trim() || undefined,
      start_time: startIso,
      end_time: endIso,
      location: location.trim() || undefined,
      is_all_day: isAllDay || undefined,
      reminder_minutes: reminder ? Number(reminder) : undefined,
      tags: tags.length > 0 ? tags : undefined,
      created_at: now,
      updated_at: now,
    });

    useToastStore.getState().addToast('success', 'Event created');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New Event" className="cc-event-dialog">
      <div className="cc-event-form">
        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-title">Title</label>
          <input
            id="evt-title"
            className="cc-event-form__input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            autoFocus
          />
        </div>

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-date">Date</label>
          <input
            id="evt-date"
            className="cc-event-form__input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="cc-event-form__row">
          <span className="cc-event-form__label">All day</span>
          <Toggle checked={isAllDay} onChange={setIsAllDay} />
        </div>

        {!isAllDay && (
          <div className="cc-event-form__time-row">
            <div className="cc-event-form__field cc-event-form__field--half">
              <label className="cc-event-form__label" htmlFor="evt-start">Start time</label>
              <input
                id="evt-start"
                className="cc-event-form__input"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="cc-event-form__field cc-event-form__field--half">
              <label className="cc-event-form__label" htmlFor="evt-end">End time</label>
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
          <label className="cc-event-form__label" htmlFor="evt-location">Location</label>
          <input
            id="evt-location"
            className="cc-event-form__input"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Add location (optional)"
          />
        </div>

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-desc">Description</label>
          <textarea
            id="evt-desc"
            className="cc-event-form__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description (optional)"
            rows={3}
          />
        </div>

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-tags">Tags</label>
          <input
            id="evt-tags"
            className="cc-event-form__input"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="Comma-separated tags (optional)"
          />
        </div>

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-reminder">Reminder</label>
          <select
            id="evt-reminder"
            className="cc-event-form__select"
            value={reminder}
            onChange={(e) => setReminder(e.target.value)}
          >
            {REMINDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="cc-dialog__actions">
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={!title.trim()}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}
