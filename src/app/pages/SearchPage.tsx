import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { useTodosQuery, useEventsQuery, useToggleTodoComplete } from '../hooks/queries';
import apiClient from '../services/apiClient';
import TaskCard from '../components/shared/TaskCard';
import EventCard from '../components/shared/EventCard';
import EmptyState from '../components/shared/EmptyState';
import { MagnifyingGlassIcon } from '../components/shared/Icons';
import type { TodoResponse, EventResponse } from '../types/api';

type ResultType = 'all' | 'tasks' | 'events';

interface ServerResults {
  tasks: TodoResponse[];
  events: EventResponse[];
}

export default function SearchPage() {
  const navigate = useNavigate();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const { data: todos = [] } = useTodosQuery();
  const { data: events = [] } = useEventsQuery();
  const toggleMutation = useToggleTodoComplete();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ResultType>('all');
  const [serverResults, setServerResults] = useState<ServerResults | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = query.toLowerCase().trim();

  // Server search (debounced)
  const doServerSearch = useCallback(async (searchQuery: string) => {
    if (!serverUrl || !searchQuery.trim()) {
      setServerResults(null);
      return;
    }
    setSearching(true);
    try {
      const types = filter === 'all' ? 'todos,events' : filter === 'tasks' ? 'todos' : filter;
      const res = await apiClient.get('/search', { params: { q: searchQuery, types } });
      const data = res.data;
      setServerResults({
        tasks: data.todos ?? [],
        events: data.events ?? [],
      });
    } catch {
      // Fall back to client-side search
      setServerResults(null);
    } finally {
      setSearching(false);
    }
  }, [serverUrl, filter]);

  // Debounced server search on query change
  useEffect(() => {
    if (!serverUrl || !q) {
      setServerResults(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doServerSearch(q);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, serverUrl, doServerSearch]);

  // Client-side search (used in demo mode or as fallback)
  const clientResults = useMemo(() => {
    if (!q) return { tasks: [], events: [] };

    const tasks = (filter === 'all' || filter === 'tasks')
      ? todos.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.description?.toLowerCase().includes(q) ||
            t.tags?.some((tag) => tag.toLowerCase().includes(q)),
        )
      : [];

    const evts = (filter === 'all' || filter === 'events')
      ? events.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.description?.toLowerCase().includes(q) ||
            e.location?.toLowerCase().includes(q),
        )
      : [];

    return { tasks, events: evts };
  }, [q, filter, todos, events]);

  // Use server results when available, otherwise fall back to client-side
  const results = serverResults ?? clientResults;
  const totalCount = results.tasks.length + results.events.length;

  const handleToggle = useCallback((id: string) => {
    const todo = todos.find((t) => t.id === id);
    if (todo) toggleMutation.mutate({ id, currentStatus: todo.status });
  }, [todos, toggleMutation]);

  const filters: { value: ResultType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'tasks', label: 'Tasks' },
    { value: 'events', label: 'Events' },
  ];

  return (
    <div>
      <div className="cc-page-header">
        <div className="cc-page-header__title">Search</div>
        <div className="cc-page-header__subtitle">
          Find across all modules
        </div>
      </div>

      <input
        className="cc-search__input"
        type="text"
        placeholder="Search tasks and events..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <div className="cc-search__filters">
        {filters.map((f) => (
          <button
            key={f.value}
            className={`cc-search__filter-btn${filter === f.value ? ' cc-search__filter-btn--active' : ''}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!q ? (
        <EmptyState icon={<MagnifyingGlassIcon size={20} />} message="Type to search across tasks and events" />
      ) : searching ? (
        <div className="cc-empty__message" style={{ padding: 40, textAlign: 'center' }}>Searching...</div>
      ) : totalCount === 0 ? (
        <EmptyState icon={<MagnifyingGlassIcon size={20} />} message={`No results for "${query}"`} />
      ) : (
        <div className="cc-search__results">
          <div className="cc-search__result-count">
            {totalCount} result{totalCount !== 1 ? 's' : ''}
          </div>

          {results.tasks.length > 0 && (
            <div className="cc-search__section">
              <div className="cc-search__section-title">Tasks ({results.tasks.length})</div>
              {results.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onToggle={() => handleToggle(task.id)}
                  onClick={() => navigate(`/tasks/${task.id}`)}
                />
              ))}
            </div>
          )}

          {results.events.length > 0 && (
            <div className="cc-search__section">
              <div className="cc-search__section-title">Events ({results.events.length})</div>
              {results.events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onClick={() => navigate(`/events/${event.id}`)}
                />
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
