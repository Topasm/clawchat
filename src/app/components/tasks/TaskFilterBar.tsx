import { useEffect, useMemo, useRef, useState } from 'react';
import { useModuleStore } from '../../stores/useModuleStore';
import { useTodosQuery } from '../../hooks/queries';
import { translateUi } from '../../i18n';
import type { TasksStatusFilter } from '../../utils/taskStatus';

const SORT_OPTIONS = [
  { value: 'due_date-asc', label: () => translateUi('Due date') },
  { value: 'created_at-desc', label: () => translateUi('Newest') },
  { value: 'updated_at-desc', label: () => translateUi('Recently updated') },
  { value: 'title-asc', label: () => translateUi('Title') },
] as const;

const OPEN_SEARCH_EVENT = 'cc:task-search';

interface TaskViewMenuProps {
  statusFilter: TasksStatusFilter;
  onStatusFilterChange: (filter: TasksStatusFilter) => void;
}

/**
 * The controls over the task list: a search box in the header, and "View ▾",
 * which names the sort and opens a menu with sort, completed tasks, blocked
 * tasks and tags. Search sits outside the menu so it is found at a glance.
 */
export default function TaskViewMenu({ statusFilter, onStatusFilterChange }: TaskViewMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filters = useModuleStore((s) => s.kanbanFilters);
  const setSearch = useModuleStore((s) => s.setKanbanSearchQuery);
  const toggleTag = useModuleStore((s) => s.toggleKanbanTagFilter);
  const setSort = useModuleStore((s) => s.setKanbanSort);
  const setBlockedOnly = useModuleStore((s) => s.setKanbanBlockedOnly);
  const clearFilters = useModuleStore((s) => s.clearKanbanFilters);
  const { data: todos = [] } = useTodosQuery();
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    todos.forEach((t) => t.tags?.forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [todos]);
  const hasActiveFilters = Boolean(
    filters.searchQuery || filters.tags.length > 0 || filters.blockedOnly,
  );
  const sortValue = `${filters.sortField}-${filters.sortDirection}`;
  const sortLabel = (
    SORT_OPTIONS.find((option) => option.value === sortValue) ?? SORT_OPTIONS[0]
  ).label();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  // The search shortcut (/) lands in the header's search box.
  useEffect(() => {
    const handler = () => searchInputRef.current?.focus();
    window.addEventListener(OPEN_SEARCH_EVENT, handler);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, handler);
  }, []);

  return (
    <div className="cc-task-view" ref={rootRef}>
      <input
        ref={searchInputRef}
        className="cc-task-view__search"
        type="search"
        aria-label={translateUi('Search tasks')}
        placeholder={translateUi('Search tasks…')}
        value={filters.searchQuery}
        onChange={(e) => setSearch(e.target.value)}
      />
      <button
        type="button"
        className={`cc-task-view__trigger${hasActiveFilters ? ' cc-task-view__trigger--filtered' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {translateUi('View')}
        <span className="cc-task-view__sort"> · {sortLabel}</span>
        <span aria-hidden="true" className="cc-task-view__chevron">
          ▾
        </span>
      </button>
      {open && (
        <div className="cc-task-view__popover" role="dialog" aria-label={translateUi('View')}>
          <div
            className="cc-task-view__group cc-task-view__group--first"
            role="radiogroup"
            aria-label={translateUi('Sort tasks')}
          >
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={sortValue === opt.value}
                className="cc-task-view__option"
                onClick={() => {
                  const [field, dir] = opt.value.split('-') as [
                    typeof filters.sortField,
                    typeof filters.sortDirection,
                  ];
                  setSort(field, dir);
                }}
              >
                <i className="cc-task-view__mark" aria-hidden="true" />
                {opt.label()}
              </button>
            ))}
          </div>
          <div className="cc-task-view__group">
            <label className="cc-task-view__toggle">
              <input
                type="checkbox"
                checked={statusFilter !== 'active'}
                onChange={(event) => onStatusFilterChange(event.target.checked ? 'all' : 'active')}
              />
              {translateUi('Show completed')}
            </label>
            <label className="cc-task-view__toggle">
              <input
                type="checkbox"
                checked={Boolean(filters.blockedOnly)}
                onChange={(e) => setBlockedOnly(e.target.checked)}
              />
              {translateUi('Blocked only')}
            </label>
          </div>
          {allTags.length > 0 && (
            <div
              className="cc-task-view__group cc-task-view__tags"
              aria-label={translateUi('Tags')}
            >
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={filters.tags.includes(tag)}
                  className="cc-task-view__tag"
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          {hasActiveFilters && (
            <button type="button" className="cc-task-view__clear" onClick={clearFilters}>
              {translateUi('Clear')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The search shortcut: focuses the header's search box. */
export function focusTaskSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}
