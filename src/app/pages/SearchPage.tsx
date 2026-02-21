import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { useModuleStore } from '../stores/useModuleStore';
import apiClient from '../services/apiClient';
import TaskCard from '../components/shared/TaskCard';
import EventCard from '../components/shared/EventCard';
import Badge from '../components/shared/Badge';
import EmptyState from '../components/shared/EmptyState';
import type { TodoResponse, EventResponse, MemoResponse } from '../types/api';

type ResultType = 'all' | 'tasks' | 'events' | 'memos';

interface ServerResults {
  tasks: TodoResponse[];
  events: EventResponse[];
  memos: MemoResponse[];
}

export default function SearchPage() {
  const navigate = useNavigate();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const todos = useModuleStore((s) => s.todos);
  const events = useModuleStore((s) => s.events);
  const memos = useModuleStore((s) => s.memos);
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);

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
      const types = filter === 'all' ? 'todos,events,memos' : filter === 'tasks' ? 'todos' : filter;
      const res = await apiClient.get('/search', { params: { q: searchQuery, types } });
      const data = res.data;
      setServerResults({
        tasks: data.todos ?? [],
        events: data.events ?? [],
        memos: data.memos ?? [],
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
    if (!q) return { tasks: [], events: [], memos: [] };

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

    const mms = (filter === 'all' || filter === 'memos')
      ? memos.filter(
          (m) =>
            m.content.toLowerCase().includes(q) ||
            m.tags?.some((tag) => tag.toLowerCase().includes(q)),
        )
      : [];

    return { tasks, events: evts, memos: mms };
  }, [q, filter, todos, events, memos]);

  // Use server results when available, otherwise fall back to client-side
  const results = serverResults ?? clientResults;
  const totalCount = results.tasks.length + results.events.length + results.memos.length;

  const filters: { value: ResultType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'tasks', label: 'Tasks' },
    { value: 'events', label: 'Events' },
    { value: 'memos', label: 'Memos' },
  ];

  return (
    <div>
      <div className="cc-page-header">
        <div className="cc-page-header__title">Search</div>
        <div className="cc-page-header__subtitle">
          Find across all modules{serverUrl ? '' : ' (demo mode)'}
        </div>
      </div>

      <input
        className="cc-search__input"
        type="text"
        placeholder="Search tasks, events, memos..."
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
        <EmptyState icon="🔍" message="Type to search across tasks, events, and memos" />
      ) : searching ? (
        <div className="cc-empty__message" style={{ padding: 40, textAlign: 'center' }}>Searching...</div>
      ) : totalCount === 0 ? (
        <EmptyState icon="😕" message={`No results for "${query}"`} />
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
                  onToggle={() => toggleTodoComplete(task.id)}
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

          {results.memos.length > 0 && (
            <div className="cc-search__section">
              <div className="cc-search__section-title">Memos ({results.memos.length})</div>
              {results.memos.map((memo) => (
                <div key={memo.id} className="cc-search__memo-card">
                  <div className="cc-search__memo-content">{memo.content}</div>
                  <div className="cc-search__memo-meta">
                    {memo.tags?.map((tag) => (
                      <Badge key={tag} variant="tag">{tag}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
