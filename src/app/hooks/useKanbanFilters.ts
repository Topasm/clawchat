import { useMemo } from 'react';
import type { TodoResponse } from '../types/api';

interface KanbanFilters {
  searchQuery: string;
  tags: string[];
  sortField: 'title' | 'due_date' | 'created_at' | 'updated_at' | 'sort_order';
  sortDirection: 'asc' | 'desc';
  showSubTasks?: boolean;
}

export default function useKanbanFilters(todos: TodoResponse[], filters: KanbanFilters) {
  return useMemo(() => {
    let result = [...todos];

    // Text search
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.tags?.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    // Tag filter
    if (filters.tags.length > 0) {
      result = result.filter((t) => t.tags?.some((tag) => filters.tags.includes(tag)));
    }

    // Sort
    result.sort((a, b) => {
      const dir = filters.sortDirection === 'asc' ? 1 : -1;
      switch (filters.sortField) {
        case 'title':
          return dir * a.title.localeCompare(b.title);
        case 'due_date': {
          const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
          const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
          return dir * (da - db);
        }
        case 'updated_at':
          return dir * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
        case 'sort_order':
          return dir * ((a.sort_order ?? 0) - (b.sort_order ?? 0));
        case 'created_at':
        default:
          return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      }
    });

    return result;
  }, [todos, filters]);
}
