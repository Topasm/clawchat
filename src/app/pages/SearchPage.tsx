import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import TaskCard from '../components/shared/TaskCard';
import EventCard from '../components/shared/EventCard';
import Badge from '../components/shared/Badge';
import EmptyState from '../components/shared/EmptyState';

type ResultType = 'all' | 'tasks' | 'events' | 'memos';

export default function SearchPage() {
  const navigate = useNavigate();
  const todos = useModuleStore((s) => s.todos);
  const events = useModuleStore((s) => s.events);
  const memos = useModuleStore((s) => s.memos);
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ResultType>('all');

  const q = query.toLowerCase().trim();

  const results = useMemo(() => {
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
        <div className="cc-page-header__subtitle">Find across all modules</div>
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
