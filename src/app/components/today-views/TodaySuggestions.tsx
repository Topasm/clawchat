import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAnswerTodaySuggestion,
  useTodaySuggestionsQuery,
  useUpdateTodo,
} from '../../hooks/queries';
import type { BriefingSuggestion } from '../../hooks/useTodayBriefing';
import { getAppLanguage, translateUi } from '../../i18n';
import type { TodaySuggestion } from '../../types/schemas';
import { ChevronRightIcon } from '../shared/Icons';

function locale(): string {
  return getAppLanguage() === 'ko' ? 'ko-KR' : 'en-US';
}

function day(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale(), { month: 'numeric', day: 'numeric' });
}

/** "Thu 14:00–16:00" on the viewer's clock. */
function block(start: string, end: string): string {
  const from = new Date(start);
  const weekday = from.toLocaleDateString(locale(), { weekday: 'short' });
  const clock = (value: Date) =>
    value.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${weekday} ${clock(from)}–${clock(new Date(end))}`;
}

function title(item: TodaySuggestion): string {
  if (item.kind === 'time_block' && item.block_start && item.block_end) {
    return translateUi('{{when}}: {{title}}', {
      when: block(item.block_start, item.block_end),
      title: item.title,
    });
  }
  return item.title;
}

/** Why it is suggested, in a few words. */
function reason(item: TodaySuggestion): string {
  const date = day(item.event_start);
  switch (item.kind) {
    case 'prepare_exam':
      return translateUi('Exam on {{date}} · due the day before', { date });
    case 'submit':
      return translateUi('Due {{date}}', { date: day(item.due_at) });
    case 'prepare_talk':
      return translateUi('Talk on {{date}} · due two days before', { date });
    case 'prepare_meeting':
      return translateUi('Meeting on {{date}} · due the day before', { date });
    case 'meeting_notes':
      return translateUi('{{event}} just ended', { event: item.event_title ?? '' });
    case 'link_project':
      return translateUi('A repeating event');
    case 'time_block':
      return translateUi('Due {{date}} · this time is free', { date: day(item.due_at) });
    default:
      return '';
  }
}

function kindLabel(item: TodaySuggestion): string {
  if (item.kind === 'meeting_notes') return translateUi('Note');
  if (item.kind === 'time_block') return translateUi('Time');
  if (item.kind === 'link_project') return translateUi('Project');
  return translateUi('Task');
}

interface TodaySuggestionsProps {
  /** The briefing's own suggestions, shown in the same list. */
  briefingSuggestions?: BriefingSuggestion[];
}

/**
 * Today's suggestions as one folded line, "Suggestions 3". Unfolded, each row
 * has one button: Add, or Undo once added. Calendar suggestions come first,
 * then the briefing's.
 */
export default function TodaySuggestions({ briefingSuggestions = [] }: TodaySuggestionsProps) {
  const navigate = useNavigate();
  const { data } = useTodaySuggestionsQuery();
  const answer = useAnswerTodaySuggestion();
  const updateTodo = useUpdateTodo();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const items = data?.suggestions ?? [];
  const briefing = briefingSuggestions.filter((_, index) => !hidden.has(index));
  const count = items.length + briefing.length;
  if (count === 0) return null;

  const busy = (id: string) => answer.isPending && answer.variables?.id === id;

  return (
    <section className="cc-today-suggestions" aria-label={translateUi('Suggestions')}>
      <button
        type="button"
        className="cc-today-suggestions__line"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRightIcon
          size={16}
          className={`cc-section__chevron${open ? ' cc-section__chevron--open' : ''}`}
        />
        <span className="cc-today-suggestions__count">
          {translateUi('Suggestions {{count}}', { count })}
        </span>
      </button>
      {open && (
        <ul className="cc-today-suggestions__list">
          {items.map((item) => (
            <li key={item.id} className="cc-today-suggestions__row">
              <div className="cc-today-suggestions__text">
                <span className="cc-today-suggestions__title">{title(item)}</span>
                <span className="cc-today-suggestions__why">
                  <span className="cc-today-suggestions__kind">{kindLabel(item)}</span>
                  {reason(item)}
                  {item.status === 'accepted' &&
                    (item.auto_added
                      ? ` · ${translateUi('Added automatically')}`
                      : ` · ${translateUi('Added')}`)}
                </span>
              </div>
              {item.status === 'accepted' ? (
                <button
                  type="button"
                  className="cc-link-btn"
                  disabled={busy(item.id)}
                  onClick={() => answer.mutate({ id: item.id, answer: 'undo' })}
                >
                  {translateUi('Undo')}
                </button>
              ) : (
                <span className="cc-today-suggestions__actions">
                  <button
                    type="button"
                    className="cc-btn cc-btn--compact cc-btn--ghost"
                    disabled={busy(item.id)}
                    onClick={() => answer.mutate({ id: item.id, answer: 'accept' })}
                  >
                    {translateUi('Add')}
                  </button>
                  <button
                    type="button"
                    className="cc-today-suggestions__dismiss"
                    aria-label={translateUi('Dismiss {{title}}', { title: item.title })}
                    disabled={busy(item.id)}
                    onClick={() => answer.mutate({ id: item.id, answer: 'dismiss' })}
                  >
                    ×
                  </button>
                </span>
              )}
            </li>
          ))}
          {briefingSuggestions.map((suggestion, index) =>
            hidden.has(index) ? null : (
              <li key={`briefing-${index}`} className="cc-today-suggestions__row">
                <div className="cc-today-suggestions__text">
                  <span className="cc-today-suggestions__title">{suggestion.title}</span>
                  <span className="cc-today-suggestions__why">{suggestion.reason}</span>
                </div>
                <button
                  type="button"
                  className="cc-btn cc-btn--compact cc-btn--ghost"
                  onClick={() => {
                    if (suggestion.action === 'move_to_tomorrow') {
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      tomorrow.setHours(23, 59, 0, 0);
                      updateTodo.mutate({
                        id: suggestion.todo_id,
                        data: { due_date: tomorrow.toISOString() },
                      });
                      setHidden(new Set(hidden).add(index));
                    } else {
                      navigate(`/tasks/${suggestion.todo_id}`);
                    }
                  }}
                >
                  {suggestion.action === 'move_to_tomorrow'
                    ? translateUi('Move to tomorrow')
                    : suggestion.action === 'reschedule'
                      ? translateUi('Reschedule')
                      : translateUi('Start')}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
