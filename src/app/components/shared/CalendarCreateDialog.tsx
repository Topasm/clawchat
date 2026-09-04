import { useState, useEffect } from 'react';
import Dialog from './Dialog';
import RecurrenceSelector from './RecurrenceSelector';
import { useCreateTodo } from '../../hooks/queries';
import { translateUi } from '../../i18n';

interface CalendarCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the date (ISO string or YYYY-MM-DD). */
  initialDate?: string;
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Adding to the calendar creates a task: this workspace is task-oriented, so
 * a day picked on the calendar is a deadline to work towards, not an
 * appointment. There is no separate "event" to choose here.
 */
export default function CalendarCreateDialog({
  open,
  onOpenChange,
  initialDate,
}: CalendarCreateDialogProps) {
  const createTodo = useCreateTodo();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [recurrenceRule, setRecurrenceRule] = useState<string | undefined>();

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTitle('');
      setDate(initialDate ? initialDate.slice(0, 10) : toLocalDateStr(new Date()));
      setTagsInput('');
      setRecurrenceRule(undefined);
    }
  }, [open, initialDate]);

  const isPending = createTodo.isPending;

  const parseTags = () =>
    tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

  const handleSave = () => {
    if (!title.trim() || isPending) return;

    const tags = parseTags();
    // End of the chosen day: the deadline is "by then", not "at midnight".
    const dueIso = new Date(`${date}T23:59:00`).toISOString();
    createTodo.mutate(
      {
        title: title.trim(),
        due_date: dueIso,
        tags: tags.length > 0 ? tags : undefined,
        recurrence_rule: recurrenceRule || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={translateUi('New Task')}
      className="cc-event-dialog"
    >
      <div className="cc-event-form">
        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-title">
            {translateUi('Title')}
          </label>
          <input
            id="evt-title"
            className="cc-event-form__input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={translateUi('Task title')}
            autoFocus
          />
        </div>

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-date">
            {translateUi('Due date')}
          </label>
          <input
            id="evt-date"
            className="cc-event-form__input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <span className="cc-event-form__hint">
            {translateUi('Runs from today until this day.')}
          </span>
        </div>

        <div className="cc-event-form__field">
          <label className="cc-event-form__label" htmlFor="evt-tags">
            {translateUi('Tags')}
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

        <RecurrenceSelector value={recurrenceRule} onChange={setRecurrenceRule} />

        <div className="cc-dialog__actions">
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onOpenChange(false)}
          >
            {translateUi('Cancel')}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={!title.trim() || isPending}
            onClick={handleSave}
          >
            {isPending ? translateUi('Saving...') : translateUi('Save')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
