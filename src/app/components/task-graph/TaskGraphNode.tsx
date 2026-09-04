import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { formatDueDate } from '../../utils/formatters';
import type { TaskFlowNodeProps } from './taskGraphTypes';
import { ChevronRightIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
function TaskGraphNode({ id, data }: TaskFlowNodeProps) {
  const {
    todo,
    status,
    childCount,
    completedChildCount,
    dependencyCount,
    hasVisibleChildren,
    isCollapsed,
    insight,
    proposalSelection,
    onToggleCollapse,
  } = data;
  const contextLabel = todo.project_label || todo.tags?.[0];
  const dueLabel = todo.due_date ? formatDueDate(todo.due_date) : null;
  const isAtRisk =
    insight?.due_risk !== undefined &&
    insight.due_risk !== 'none' &&
    insight.due_risk !== 'unknown_estimate';
  const insightClasses = [
    insight?.is_ready && 'cc-task-flow-node--ready',
    insight?.is_blocked && 'cc-task-flow-node--blocked',
    insight?.is_unschedulable && 'cc-task-flow-node--unschedulable',
    insight?.is_on_critical_path && 'cc-task-flow-node--critical',
    isAtRisk && 'cc-task-flow-node--at-risk',
  ]
    .filter(Boolean)
    .join(' ');
  const insightLabels = [
    insight?.is_ready && 'ready now',
    insight?.is_blocked && 'blocked',
    insight?.is_unschedulable && 'unschedulable',
    insight?.is_on_critical_path && 'critical path',
    isAtRisk && 'at risk',
  ].filter(Boolean);
  return (
    <article
      className={`cc-task-flow-node cc-task-flow-node--${status}${proposalSelection ? ` cc-task-flow-node--proposal-${proposalSelection}` : ''}${insightClasses ? ` ${insightClasses}` : ''}`}
      aria-label={`${todo.title}, ${status.replace('_', ' ')}${insightLabels.length ? `, ${insightLabels.join(', ')}` : ''}`}
    >
      <Handle type="target" position={Position.Left} className="cc-task-flow-node__handle" />
      <div className="cc-task-flow-node__topline">
        <span className={`cc-task-flow-node__status cc-task-flow-node__status--${status}`}>
          {status === 'in_progress'
            ? translateUi('In progress')
            : status === 'completed'
              ? translateUi('Done')
              : status === 'cancelled'
                ? translateUi('Cancelled')
                : translateUi('Todo')}
        </span>
        {childCount > 0 && (
          <span className="cc-task-flow-node__kind">{translateUi('Project')}</span>
        )}
        {proposalSelection && (
          <span
            className={`cc-task-flow-node__proposal-state cc-task-flow-node__proposal-state--${proposalSelection}`}
          >
            {proposalSelection === 'fixed'
              ? translateUi('Goal')
              : proposalSelection === 'selected'
                ? translateUi('Included')
                : translateUi('Excluded')}
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
      {insight && (
        <div className="cc-task-flow-node__insights" aria-label={translateUi('Execution insights')}>
          {insight.is_ready && (
            <span className="cc-task-flow-node__insight--ready">{translateUi('Ready')}</span>
          )}
          {insight.is_blocked && !insight.is_unschedulable && (
            <span className="cc-task-flow-node__insight--blocked">{translateUi('Blocked')}</span>
          )}
          {insight.is_on_critical_path && (
            <span className="cc-task-flow-node__insight--critical">
              {insight.estimate_complete
                ? translateUi('Critical')
                : translateUi('Provisional critical')}
            </span>
          )}
          {insight.is_unschedulable && (
            <span className="cc-task-flow-node__insight--blocked">
              {translateUi('Unschedulable')}
            </span>
          )}
          {isAtRisk && (
            <span className="cc-task-flow-node__insight--risk">{translateUi('At risk')}</span>
          )}
          {insight.due_risk === 'unknown_estimate' && (
            <span className="cc-task-flow-node__insight--unknown">
              {translateUi('Estimate needed')}
            </span>
          )}
          {insight.scope_role === 'context' && (
            <span className="cc-task-flow-node__insight--context">
              {translateUi('External prerequisite')}
            </span>
          )}
        </div>
      )}
      <div className="cc-task-flow-node__meta">
        {childCount > 0 && (
          <span>
            {completedChildCount}/{childCount}
            {translateUi(' sub-tasks\n          ')}
          </span>
        )}
        {dueLabel && (
          <span className={dueLabel === 'Overdue' ? 'cc-task-flow-node__due--overdue' : ''}>
            {dueLabel}
          </span>
        )}
        {dependencyCount > 0 && (
          <span>
            {dependencyCount}
            {translateUi(' dependencies')}
          </span>
        )}
      </div>

      {hasVisibleChildren && !proposalSelection && (
        <button
          type="button"
          className={`cc-task-flow-node__collapse nodrag nopan${isCollapsed ? ' cc-task-flow-node__collapse--collapsed' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse(id);
          }}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${todo.title}`}
          aria-expanded={!isCollapsed}
          title={isCollapsed ? translateUi('Show sub-tasks') : translateUi('Hide sub-tasks')}
        >
          <ChevronRightIcon
            size={16}
            style={{ transform: isCollapsed ? undefined : 'rotate(90deg)' }}
          />
          {isCollapsed && <span>{childCount}</span>}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="cc-task-flow-node__handle" />
    </article>
  );
}
export default memo(TaskGraphNode);
