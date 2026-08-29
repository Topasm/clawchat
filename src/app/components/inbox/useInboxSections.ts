import { useMemo } from 'react';

import type { TodoResponse } from '../../types/api';
import { isTerminalTaskStatus } from '../../utils/taskStatus';

export interface InboxSections {
  /** Tasks the classifier or planner is still working on. */
  processing: TodoResponse[];
  /** Tasks waiting on the user's clarification answers. */
  questioning: TodoResponse[];
  /** Tasks with a plan the user has not reviewed yet. */
  planReady: TodoResponse[];
  /** Tasks whose Inbox pipeline failed. */
  errors: TodoResponse[];
  /** Captured tasks with no home in the project graph. */
  needsOrganising: TodoResponse[];
  childCountByParent: Map<string, number>;
  todoById: Map<string, TodoResponse>;
  totalItems: number;
}

/** Splits every todo into the Inbox queue sections, ignoring terminal tasks. */
export default function useInboxSections(todos: TodoResponse[]): InboxSections {
  return useMemo(() => {
    const processing: TodoResponse[] = [];
    const questioning: TodoResponse[] = [];
    const planReady: TodoResponse[] = [];
    const errors: TodoResponse[] = [];
    const needsOrganising: TodoResponse[] = [];
    const childCountByParent = new Map<string, number>();
    const todoById = new Map<string, TodoResponse>();

    for (const todo of todos) {
      todoById.set(todo.id, todo);
      if (todo.parent_id) {
        childCountByParent.set(todo.parent_id, (childCountByParent.get(todo.parent_id) ?? 0) + 1);
      }
      if (isTerminalTaskStatus(todo.status)) continue;

      if (todo.inbox_state === 'classifying' || todo.inbox_state === 'planning') {
        processing.push(todo);
      } else if (todo.inbox_state === 'questioning') {
        questioning.push(todo);
      } else if (todo.inbox_state === 'plan_ready') {
        planReady.push(todo);
      } else if (todo.inbox_state === 'error') {
        errors.push(todo);
      } else if (
        todo.inbox_state === 'captured' ||
        ((!todo.inbox_state || todo.inbox_state === 'none') &&
          !todo.project_id &&
          !todo.due_date &&
          !todo.parent_id)
      ) {
        needsOrganising.push(todo);
      }
    }

    return {
      processing,
      questioning,
      planReady,
      errors,
      needsOrganising,
      childCountByParent,
      todoById,
      totalItems:
        processing.length +
        questioning.length +
        planReady.length +
        needsOrganising.length +
        errors.length,
    };
  }, [todos]);
}
