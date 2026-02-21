import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import { formatDateTime } from '../utils/formatters';
import type { EventResponse, EventUpdate } from '../types/api';

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const events = useModuleStore((s) => s.events);
  const serverUpdateEvent = useModuleStore((s) => s.serverUpdateEvent);
  const deleteEvent = useModuleStore((s) => s.deleteEvent);

  const event = events.find((e) => e.id === eventId);

  const [title, setTitle] = useState(event?.title ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setLocation(event.location ?? '');
      setDescription(event.description ?? '');
    }
  }, [event]);

  const persistField = useCallback((updates: EventUpdate) => {
    if (!eventId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      serverUpdateEvent(eventId, updates);
    }, 500);
    // Immediate local update
    useModuleStore.getState().updateEvent(eventId, updates as Partial<EventResponse>);
  }, [eventId, serverUpdateEvent]);

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
    await deleteEvent(eventId);
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

      <textarea
        className="cc-detail__textarea"
        value={description}
        onChange={(e) => handleDescriptionChange(e.target.value)}
        placeholder="Add a description..."
      />

      <button type="button" className="cc-btn cc-btn--danger cc-detail__delete-btn" onClick={handleDelete}>
        Delete Event
      </button>
    </div>
  );
}
