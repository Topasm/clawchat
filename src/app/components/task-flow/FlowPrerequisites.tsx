import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getPlanProposalMutationError,
  useCreateTaskRelationship,
  useDeleteTaskRelationship,
} from '../../hooks/queries';
import { useToastStore } from '../../stores/useToastStore';
import type { TaskRelationshipResponse, TodoResponse } from '../../types/api';
import { isInboxTodo } from '../../utils/inboxState';
import { isTerminalTaskStatus } from '../../utils/taskStatus';
import { translateUi } from '../../i18n';

interface FlowPrerequisitesProps {
  scopeId: string;
  todos: readonly TodoResponse[];
  steps: readonly TodoResponse[];
  /** `depends_on` rows whose dependent is one of the steps. */
  stepEdges: readonly TaskRelationshipResponse[];
  /** A new prerequisite goes to this step, or else to the flow's first steps. */
  selectedId?: string | null;
}

const MATCH_LIMIT = 6;

function failed(error: unknown) {
  useToastStore.getState().addToast('error', getPlanProposalMutationError(error).message);
}

/**
 * Tasks from outside this flow that its steps wait on, drawn left of the
 * first column. A tag opens that task or drops the edge; + finds a task to
 * wait on. Each change can be undone from its toast.
 */
export default function FlowPrerequisites({
  scopeId,
  todos,
  steps,
  stepEdges,
  selectedId,
}: FlowPrerequisitesProps) {
  const navigate = useNavigate();
  const createEdge = useCreateTaskRelationship();
  const deleteEdge = useDeleteTaskRelationship();
  const [query, setQuery] = useState<string | null>(null);

  const todoById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const stepIds = useMemo(() => new Set(steps.map((step) => step.id)), [steps]);
  const outside = useMemo(() => {
    const byTarget = new Map<string, TaskRelationshipResponse[]>();
    for (const edge of stepEdges) {
      if (stepIds.has(edge.target_task_id) || !todoById.has(edge.target_task_id)) continue;
      byTarget.set(edge.target_task_id, [...(byTarget.get(edge.target_task_id) ?? []), edge]);
    }
    return [...byTarget].map(([id, edges]) => ({ task: todoById.get(id)!, edges }));
  }, [stepEdges, stepIds, todoById]);

  // Where a picked task attaches: the selected step, or else the open steps
  // nothing unfinished in the flow comes before, so the rest waits on it.
  const dependents = () => {
    if (selectedId && stepIds.has(selectedId)) return [selectedId];
    const unfinished = new Set(
      stepEdges
        .filter((edge) => {
          const target = todoById.get(edge.target_task_id);
          return stepIds.has(edge.target_task_id) && target && !isTerminalTaskStatus(target.status);
        })
        .map((edge) => edge.source_task_id),
    );
    const next = steps.filter(
      (step) => !isTerminalTaskStatus(step.status) && !unfinished.has(step.id),
    );
    return (next.length > 0 ? next : steps.slice(0, 1)).map((step) => step.id);
  };

  const matches = useMemo(() => {
    if (query === null) return [];
    const taken = new Set(outside.map(({ task }) => task.id));
    const related = (todo: TodoResponse) => {
      // The task itself, its steps' own steps, or a task it sits inside.
      for (let cursor: TodoResponse | undefined = todo, depth = 0; cursor && depth < 20; depth++) {
        if (cursor.id === scopeId) return true;
        cursor = cursor.parent_id ? todoById.get(cursor.parent_id) : undefined;
      }
      for (let cursor = todoById.get(scopeId), depth = 0; cursor && depth < 20; depth++) {
        if (cursor.id === todo.id) return true;
        cursor = cursor.parent_id ? todoById.get(cursor.parent_id) : undefined;
      }
      return false;
    };
    const needle = query.trim().toLowerCase();
    return todos
      .filter(
        (todo) =>
          !isTerminalTaskStatus(todo.status) &&
          !isInboxTodo(todo) &&
          !taken.has(todo.id) &&
          (!needle || todo.title.toLowerCase().includes(needle)) &&
          !related(todo),
      )
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, MATCH_LIMIT);
  }, [outside, query, scopeId, todoById, todos]);

  const add = async (task: TodoResponse) => {
    setQuery(null);
    const sources = dependents();
    if (sources.length === 0) return;
    const created: TaskRelationshipResponse[] = [];
    try {
      for (const source of sources) {
        created.push(
          await createEdge.mutateAsync({
            source_task_id: source,
            target_task_id: task.id,
            type: 'depends_on',
          }),
        );
      }
    } catch (error) {
      await Promise.allSettled(created.map((edge) => deleteEdge.mutateAsync(edge.id)));
      failed(error);
      return;
    }
    useToastStore.getState().addToast('success', translateUi('Prerequisite added'), {
      duration: 8000,
      action: {
        label: translateUi('Undo'),
        onClick: () => {
          void Promise.all(created.map((edge) => deleteEdge.mutateAsync(edge.id))).catch(failed);
        },
      },
    });
  };

  const remove = async (edges: TaskRelationshipResponse[]) => {
    try {
      await Promise.all(edges.map((edge) => deleteEdge.mutateAsync(edge.id)));
    } catch (error) {
      failed(error);
      return;
    }
    useToastStore.getState().addToast('success', translateUi('Prerequisite removed'), {
      duration: 8000,
      action: {
        label: translateUi('Undo'),
        onClick: () => {
          void Promise.all(
            edges.map((edge) =>
              createEdge.mutateAsync({
                source_task_id: edge.source_task_id,
                target_task_id: edge.target_task_id,
                type: 'depends_on',
              }),
            ),
          ).catch(failed);
        },
      },
    });
  };

  return (
    <div className="cc-flow__lead">
      {outside.map(({ task, edges }) => (
        <span key={task.id} className="cc-flow__tag">
          <button type="button" onClick={() => navigate(`/tasks/${task.id}`)}>
            {translateUi('Other task: {{title}}', { title: task.title })}
          </button>
          <button
            type="button"
            className="cc-flow__tag-remove"
            aria-label={translateUi('Remove {{title}}', { title: task.title })}
            onClick={() => void remove(edges)}
          >
            ×
          </button>
        </span>
      ))}
      {query === null ? (
        <button type="button" className="cc-flow__tag-add" onClick={() => setQuery('')}>
          + {translateUi('Prerequisite')}
        </button>
      ) : (
        <div className="cc-flow__pick">
          <input
            autoFocus
            value={query}
            placeholder={translateUi('Search tasks…')}
            aria-label={translateUi('Prerequisite')}
            onChange={(event) => setQuery(event.target.value)}
            onBlur={(event) => {
              if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setQuery(null);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') setQuery(null);
              else if (event.key === 'Enter' && matches[0]) {
                event.preventDefault();
                void add(matches[0]);
              }
            }}
          />
          {matches.map((task) => (
            <button
              key={task.id}
              type="button"
              // WebKit does not focus a clicked button, so keep the field's focus.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void add(task)}
            >
              {task.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
