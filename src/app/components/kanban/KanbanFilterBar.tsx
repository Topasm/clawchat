import { useMemo, useRef } from 'react';
import { useModuleStore } from '../../stores/useModuleStore';
import { useTodosQuery } from '../../hooks/queries';
import { MagnifyingGlassIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
const SORT_OPTIONS = [
  { value: 'created_at', label: 'Date Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Due Date' },
  { value: 'title', label: 'Title' },
  { value: 'updated_at', label: 'Last Updated' },
  { value: 'sort_order', label: 'Manual Order' },
] as const;
interface KanbanFilterBarProps {
  showSubtaskToggle?: boolean;
}
export default function KanbanFilterBar({ showSubtaskToggle = true }: KanbanFilterBarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filters = useModuleStore((s) => s.kanbanFilters);
  const setSearch = useModuleStore((s) => s.setKanbanSearchQuery);
  const togglePriority = useModuleStore((s) => s.toggleKanbanPriorityFilter);
  const toggleTag = useModuleStore((s) => s.toggleKanbanTagFilter);
  const setSort = useModuleStore((s) => s.setKanbanSort);
  const clearFilters = useModuleStore((s) => s.clearKanbanFilters);
  const toggleSubTasks = useModuleStore((s) => s.toggleShowSubTasks);
  const { data: todos = [] } = useTodosQuery();
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    todos.forEach((t) => t.tags?.forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [todos]);
  const hasActiveFilters =
    filters.searchQuery || filters.priorities.length > 0 || filters.tags.length > 0;
  return (
    <div className="cc-kanban-filter">
      <div className="cc-kanban-filter__search">
        <MagnifyingGlassIcon className="cc-kanban-filter__search-icon" size={14} />
        <input
          ref={searchInputRef}
          className="cc-kanban-filter__search-input"
          type="text"
          aria-label={translateUi('Search tasks')}
          placeholder={translateUi('Search tasks\u2026')}
          value={filters.searchQuery}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="cc-kanban-filter__chips">
        {PRIORITIES.map((p) => (
          <button
            key={p}
            className={`cc-kanban-filter__chip cc-kanban-filter__chip--${p}${filters.priorities.includes(p) ? ' cc-kanban-filter__chip--active' : ''}`}
            aria-pressed={filters.priorities.includes(p)}
            onClick={() => togglePriority(p)}
          >
            {translateUi(p.charAt(0).toUpperCase() + p.slice(1))}
          </button>
        ))}
      </div>

      {allTags.length > 0 && (
        <select
          className="cc-kanban-filter__select"
          aria-label={translateUi('Filter tasks by tag')}
          value=""
          onChange={(e) => {
            if (e.target.value) toggleTag(e.target.value);
          }}
        >
          <option value="">
            {filters.tags.length > 0
              ? translateUi('Tags ({{count}})', { count: filters.tags.length })
              : translateUi('Filter by tag')}
          </option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>
              {filters.tags.includes(tag) ? '✓ ' : ''}
              {tag}
            </option>
          ))}
        </select>
      )}

      <select
        className="cc-kanban-filter__select"
        aria-label={translateUi('Sort tasks')}
        value={`${filters.sortField}-${filters.sortDirection}`}
        onChange={(e) => {
          const [field, dir] = e.target.value.split('-') as [
            typeof filters.sortField,
            typeof filters.sortDirection,
          ];
          setSort(field, dir);
        }}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={`${opt.value}-desc`} value={`${opt.value}-desc`}>
            ↓ {translateUi(opt.label)}
          </option>
        ))}
        {SORT_OPTIONS.map((opt) => (
          <option key={`${opt.value}-asc`} value={`${opt.value}-asc`}>
            ↑ {translateUi(opt.label)}
          </option>
        ))}
      </select>

      {showSubtaskToggle && (
        <button
          className={`cc-kanban-filter__chip${filters.showSubTasks ? ' cc-kanban-filter__chip--active' : ''}`}
          aria-pressed={filters.showSubTasks}
          onClick={toggleSubTasks}
        >
          {translateUi('\n          Sub-tasks\n        ')}
        </button>
      )}

      {hasActiveFilters && (
        <button className="cc-kanban-filter__clear" onClick={clearFilters}>
          {translateUi('\n          Clear\n        ')}
        </button>
      )}
    </div>
  );
}
export function focusKanbanSearch() {
  const el = document.querySelector<HTMLInputElement>('.cc-kanban-filter__search-input');
  el?.focus();
}
