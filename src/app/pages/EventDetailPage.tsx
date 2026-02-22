import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import { useDebouncedPersist } from '../hooks/useDebouncedPersist';
import { formatDateTime } from '../utils/formatters';
import type { EventResponse, EventUpdate } from '../types/api';

function describeRecurrence(rule: string): string {
  const clean = rule.replace('RRULE:', '');
  const params = Object.fromEntries(clean.split(';').map((p) => p.split('=')));
  const freq = params.FREQ?.toLowerCase() ?? '';
  let desc = freq === 'daily' ? 'Every day' : freq === 'weekly' ? 'Every week' : freq === 'monthly' ? 'Every month' : freq === 'yearly' ? 'Every year' : `Every ${freq}`;
  if (params.BYDAY) desc += ` on ${params.BYDAY}`;
  if (params.COUNT) desc += `, ${params.COUNT} times`;
  if (params.UNTIL) desc += `, until ${params.UNTIL.slice(0, 8)}`;
  return desc;
}

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const events = useModuleStore((s) => s.events);
  const serverUpdateEvent = useModuleStore((s) => s.serverUpdateEvent);
  const deleteEvent = useModuleStore((s) => s.deleteEvent);
  const deleteEventOccurrence = useModuleStore((s) => s.deleteEventOccurrence);

  const event = events.find((e) => e.id === eventId);

  const [title, setTitle] = useState(event?.title ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [showDeleteMode, setShowDeleteMode] = useState(false);

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setLocation(event.location ?? '');
      setDescription(event.description ?? '');
    }
  }, [event]);

  const localUpdateEvent = useCallback((id: string, updates: EventUpdate) => {
    useModuleStore.getState().updateEvent(id, updates as Partial<EventResponse>);
  }, []);

  const persistField = useDebouncedPersist<EventUpdate>(eventId, serverUpdateEvent, localUpdateEvent);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    persistField({ title: val });
  };

  const handleLocationChange = (val: string) => {
    setLocation(val);
    persistField({ location: val });
  };

  const handleDescriptionChange = (val: string) => {
    setDescription(val);
    persistField({ description: val });
  };

  const handleDelete = async () => {
    if (!eventId) return;
    if (event?.recurrence_rule) {
      setShowDeleteMode(true);
      return;
    }
    await deleteEvent(eventId);
    navigate('/today');
  };

  const handleDeleteMode = async (mode: 'this_only' | 'this_and_future' | 'all') => {
    if (!eventId || !event) return;
    setShowDeleteMode(false);
    if (mode === 'all') {
      await deleteEvent(eventId);
    } else {
      const occDate = event.occurrence_date ?? new Date(event.start_time).toISOString().slice(0, 10);
      await deleteEventOccurrence(eventId, occDate, mode);
    }
    navigate('/today');
  };

  if (!event) {
    return (
      <div className="cc-detail">
        <div className="cc-page-header__subtitle">Event not found</div>
        <button type="button" className="cc-btn cc-btn--secondary cc-mt-16" onClick={() => navigate('/today')}>
          Back to today
        </button>
      </div>
    );
  }

  return (
    <div className="cc-detail">
      <input
        className="cc-detail__title-input"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder="Event title"
      />

      <div className="cc-detail__field">
        <span className="cc-detail__field-label">Start</span>
        <div className="cc-detail__field-value">{formatDateTime(event.start_time)}</div>
      </div>

      {event.end_time && (
        <div className="cc-detail__field">
          <span className="cc-detail__field-label">End</span>
          <div className="cc-detail__field-value">{formatDateTime(event.end_time)}</div>
        </div>
      )}

      <div className="cc-detail__field">
        <span className="cc-detail__field-label">Location</span>
        <input
          className="cc-detail__field-btn"
          style={{ border: 'none', flex: 1, background: 'transparent', color: 'var(--cc-text)', fontSize: 14 }}
          value={location}
          onChange={(e) => handleLocationChange(e.target.value)}
          placeholder="Add location"
        />
      </div>

      {event.recurrence_rule && (
        <div className="cc-detail__field">
          <span className="cc-detail__field-label">Repeats</span>
          <div className="cc-detail__field-value">{describeRecurrence(event.recurrence_rule)}</div>
        </div>
      )}

      <textarea
        className="cc-detail__textarea"
        value={description}
        onChange={(e) => handleDescriptionChange(e.target.value)}
        placeholder="Add a description..."
      />

      <button type="button" className="cc-btn cc-btn--danger cc-detail__delete-btn" onClick={handleDelete}>
        Delete Event
      </button>

      {showDeleteMode && (
        <div className="cc-detail__delete-mode">
          <p className="cc-detail__field-label">This is a recurring event. Delete:</p>
          <button type="button" className="cc-btn cc-btn--secondary cc-mb-8" onClick={() => handleDeleteMode('this_only')}>
            This occurrence only
          </button>
          <button type="button" className="cc-btn cc-btn--secondary cc-mb-8" onClick={() => handleDeleteMode('this_and_future')}>
            This and future events
          </button>
          <button type="button" className="cc-btn cc-btn--danger" onClick={() => handleDeleteMode('all')}>
            All events in series
          </button>
        </div>
      )}
    </div>
  );
}
