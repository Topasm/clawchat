import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { formatDueDate } from '../../utils/formatters';
import type { TaskFlowNodeProps } from './taskGraphTypes';
import { ChevronRightIcon } from '../shared/Icons';

function TaskGraphNode({ id, data }: TaskFlowNodeProps) {
  const {
    todo,
    status,
    childCount,
    completedChildCount,
    hasVisibleChildren,
    isCollapsed,
    proposalSelection,
    onToggleCollapse,
  } = data;
  const priority = todo.priority ?? 'medium';
  const contextLabel = todo.project_label || todo.tags?.[0];
  const dueLabel = todo.due_date ? formatDueDate(todo.due_date) : null;

  return (
    <article
      className={`cc-task-flow-node cc-task-flow-node--${status}${proposalSelection ? ` cc-task-flow-node--proposal-${proposalSelection}` : ''}`}
      aria-label={`${todo.title}, ${status.replace('_', ' ')}`}
    >
      <Handle type="target" position={Position.Left} className="cc-task-flow-node__handle" />
      <span className={`cc-task-flow-node__priority cc-task-flow-node__priority--${priority}`} />
      <div className="cc-task-flow-node__topline">
        <span className={`cc-task-flow-node__status cc-task-flow-node__status--${status}`}>
          {status === 'in_progress' ? 'In progress' : status === 'completed' ? 'Done' : 'Todo'}
        </span>
        {childCount > 0 && <span className="cc-task-flow-node__kind">Project</span>}
        {proposalSelection && (
          <span
            className={`cc-task-flow-node__proposal-state cc-task-flow-node__proposal-state--${proposalSelection}`}
          >
            {proposalSelection === 'fixed'
              ? 'Goal'
              : proposalSelection === 'selected'
                ? 'Included'
                : 'Excluded'}
          </span>
        )}
        {contextLabel && (
          <span className="cc-task-flow-node__context" title={contextLabel}>
            {contextLabel}
          </span>
        )}
      </div>
      <div className="cc-task-flow-node__title" title={todo.title}>
        {todo.title}
      </div>
      <div className="cc-task-flow-node__meta">
        {childCount > 0 && (
          <span>
            {completedChildCount}/{childCount} sub-tasks
          </span>
        )}
        {dueLabel && (
          <span className={dueLabel === 'Overdue' ? 'cc-task-flow-node__due--overdue' : ''}>
            {dueLabel}
          </span>
        )}
        {(todo.depends_on?.length ?? 0) > 0 && <span>{todo.depends_on!.length} dependencies</span>}
        {childCount === 0 && !dueLabel && !todo.depends_on?.length && (
          <span>{priority} priority</span>
        )}
      </div>

      {hasVisibleChildren && !proposalSelection && (
        <button
          type="button"
          className="cc-task-flow-node__collapse nodrag nopan"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse(id);
          }}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${todo.title}`}
          aria-expanded={!isCollapsed}
          title={isCollapsed ? 'Show sub-tasks' : 'Hide sub-tasks'}
        >
          <ChevronRightIcon
            size={16}
            style={{ transform: isCollapsed ? undefined : 'rotate(90deg)' }}
          />
        </button>
      )}
      <Handle type="source" position={Position.Right} className="cc-task-flow-node__handle" />
    </article>
  );
}

export default memo(TaskGraphNode);
