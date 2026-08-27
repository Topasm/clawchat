import type {
  TaskGraphInsightIssue,
  TaskGraphInsightNode,
  TaskGraphInsightsResponse,
} from '../../types/api';
import { CloseIcon, ExternalLinkIcon, GraphIcon } from '../shared/Icons';

interface TaskGraphHealthPanelProps {
  insights?: TaskGraphInsightsResponse;
  isLoading: boolean;
  isError: boolean;
  visibleNodeCount?: number;
}

interface TaskGraphNodeInsightPanelProps {
  insight: TaskGraphInsightNode;
  allInsights: readonly TaskGraphInsightNode[];
  generatedAt: string;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return 'Estimate incomplete';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatEstimate(minutes: number | null): string {
  if (minutes === null) return 'Estimate incomplete';
  if (minutes <= 0) return 'Invalid estimate';
  return formatDuration(minutes);
}

function formatCriticalPath(insights: TaskGraphInsightsResponse): string {
  const { summary } = insights;
  if (summary.critical_path_estimate_complete) {
    return formatDuration(summary.critical_path_minutes);
  }
  if (summary.critical_path_known_minutes > 0) {
    return `${formatDuration(summary.critical_path_known_minutes)}+`;
  }
  return 'Estimate needed';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDeadline(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: value.includes('T') ? 'numeric' : undefined,
    minute: value.includes('T') ? '2-digit' : undefined,
  }).format(date);
}

function dueRiskLabel(risk: TaskGraphInsightNode['due_risk']): string {
  switch (risk) {
    case 'overdue':
      return 'Overdue';
    case 'blocked':
      return 'Blocked deadline';
    case 'insufficient_time':
      return 'Not enough time';
    case 'unknown_estimate':
      return 'Estimate needed';
    default:
      return 'On track';
  }
}

function issueTone(issue: TaskGraphInsightIssue): 'error' | 'warning' | 'info' {
  if (issue.severity === 'error') return 'error';
  if (issue.severity === 'warning') return 'warning';
  return 'info';
}

export function TaskGraphHealthPanel({
  insights,
  isLoading,
  isError,
  visibleNodeCount,
}: TaskGraphHealthPanelProps) {
  if (isLoading) {
    return (
      <div className="cc-task-insights cc-task-insights--loading" role="status">
        Calculating execution insights…
      </div>
    );
  }

  if (isError || !insights) {
    return (
      <div className="cc-task-insights cc-task-insights--error" role="status">
        Execution insights are temporarily unavailable.
      </div>
    );
  }

  const { summary } = insights;
  const healthTone =
    summary.issue_count === 0 ? 'healthy' : summary.is_healthy ? 'warning' : 'error';
  const healthLabel =
    summary.issue_count === 0
      ? 'Healthy'
      : `${summary.issue_count} ${summary.is_healthy ? 'warning' : 'issue'}${summary.issue_count === 1 ? '' : 's'}`;
  return (
    <section className="cc-task-insights" aria-label="Graph execution insights">
      <div className="cc-task-insights__heading" data-health={healthTone}>
        <GraphIcon size={14} />
        <strong>Graph health</strong>
        <span>{healthLabel}</span>
      </div>
      <dl className="cc-task-insights__metrics">
        <div className="cc-task-insights__metric cc-task-insights__metric--ready">
          <dt>Ready now</dt>
          <dd>{summary.ready_count}</dd>
        </div>
        <div className="cc-task-insights__metric cc-task-insights__metric--blocked">
          <dt>Blocked</dt>
          <dd>{summary.blocked_count}</dd>
        </div>
        <div className="cc-task-insights__metric cc-task-insights__metric--critical">
          <dt>Critical path</dt>
          <dd>{formatCriticalPath(insights)}</dd>
        </div>
        <div className="cc-task-insights__metric cc-task-insights__metric--risk">
          <dt>At risk</dt>
          <dd>{summary.at_risk_count}</dd>
        </div>
      </dl>
      {insights.issues.length > 0 && (
        <ul className="cc-task-insights__issues" aria-label="Graph health issues">
          {insights.issues.slice(0, 3).map((issue, index) => (
            <li key={`${issue.code}:${index}`} data-tone={issueTone(issue)} title={issue.message}>
              {issue.message}
            </li>
          ))}
          {insights.issues.length > 3 && <li>+{insights.issues.length - 3} more</li>}
          {insights.issues_truncated && <li>More issues are available for this graph</li>}
        </ul>
      )}
      <span className="cc-task-insights__updated">
        {visibleNodeCount !== undefined && visibleNodeCount !== insights.scope.task_count
          ? `${visibleNodeCount} visible of ${insights.scope.task_count} scoped · `
          : ''}
        Revision {insights.graph_revision} · {formatTimestamp(insights.generated_at)}
      </span>
    </section>
  );
}

function InsightTaskList({
  label,
  taskIds,
  insightById,
  totalCount = taskIds.length,
  truncated = false,
}: {
  label: string;
  taskIds: readonly string[];
  insightById: ReadonlyMap<string, TaskGraphInsightNode>;
  totalCount?: number;
  truncated?: boolean;
}) {
  if (taskIds.length === 0 && totalCount === 0) return null;
  const displayedIds = taskIds.slice(0, 4);
  const remainingCount = Math.max(0, totalCount - displayedIds.length);
  return (
    <div className="cc-task-insight-detail__group">
      <h4>{label}</h4>
      <ul>
        {displayedIds.map((taskId) => (
          <li key={taskId}>{insightById.get(taskId)?.title ?? taskId}</li>
        ))}
        {remainingCount > 0 && (
          <li>
            +{remainingCount} {truncated ? 'or more' : 'more'}
          </li>
        )}
        {truncated && remainingCount === 0 && <li>Additional results omitted</li>}
      </ul>
    </div>
  );
}

export function TaskGraphNodeInsightPanel({
  insight,
  allInsights,
  generatedAt,
  onClose,
  onOpenTask,
}: TaskGraphNodeInsightPanelProps) {
  const insightById = new Map(allInsights.map((item) => [item.task_id, item]));
  return (
    <aside className="cc-task-insight-detail" aria-label={`Execution details for ${insight.title}`}>
      <div className="cc-task-insight-detail__heading">
        <div>
          <span>Execution insight</span>
          <h3>{insight.title}</h3>
        </div>
        <button type="button" className="cc-icon-btn" onClick={onClose} aria-label="Close details">
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="cc-task-insight-detail__badges">
        <span data-state={insight.execution_state}>
          {insight.execution_state.replace('_', ' ')}
        </span>
        {insight.scope_role === 'context' && (
          <span data-state="context">External prerequisite</span>
        )}
        {insight.is_container && <span data-state="container">Structural container</span>}
        {insight.is_unschedulable && <span data-state="risk">Unschedulable</span>}
        {insight.is_on_critical_path && (
          <span data-state="critical">
            {insight.estimate_complete ? 'Critical path' : 'Provisional critical path'}
          </span>
        )}
        {insight.due_risk !== 'none' && (
          <span data-state="risk">{dueRiskLabel(insight.due_risk)}</span>
        )}
      </div>

      <dl className="cc-task-insight-detail__facts">
        <div>
          <dt>Estimate</dt>
          <dd>
            {insight.is_container
              ? 'Not counted (container)'
              : formatEstimate(insight.estimated_minutes)}
          </dd>
        </div>
        <div>
          <dt>Remaining path</dt>
          <dd>
            {insight.estimate_complete
              ? formatDuration(insight.remaining_path_minutes)
              : insight.remaining_path_known_minutes > 0
                ? `${formatDuration(insight.remaining_path_known_minutes)}+`
                : 'Estimate incomplete'}
          </dd>
        </div>
        <div>
          <dt>Downstream impact</dt>
          <dd>
            {insight.downstream_truncated ? '≥' : ''}
            {insight.downstream_count} tasks
          </dd>
        </div>
        {insight.due_date && (
          <div>
            <dt>Deadline</dt>
            <dd>{formatDeadline(insight.due_date)}</dd>
          </div>
        )}
      </dl>

      {insight.is_container && (
        <p className="cc-task-insight-detail__container-note">
          Container duration comes from descendant tasks; its stored estimate is not added to the
          critical path.
        </p>
      )}

      <InsightTaskList
        label="Direct blockers"
        taskIds={insight.direct_blocker_ids}
        insightById={insightById}
      />
      <InsightTaskList
        label="Additional blockers"
        taskIds={insight.transitive_blocker_ids}
        insightById={insightById}
        totalCount={insight.transitive_blocker_count}
        truncated={insight.transitive_blockers_truncated}
      />
      <InsightTaskList
        label="Affected downstream"
        taskIds={insight.downstream_task_ids}
        insightById={insightById}
        totalCount={insight.downstream_count}
        truncated={insight.downstream_truncated}
      />

      {insight.status !== 'completed' &&
        insight.status !== 'cancelled' &&
        !insight.is_blocked &&
        insight.direct_blocker_ids.length === 0 && (
          <p className="cc-task-insight-detail__clear">
            {insight.is_ready ? 'All prerequisites are complete.' : 'No active blockers.'}
          </p>
        )}

      <div className="cc-task-insight-detail__actions">
        <span>Calculated {formatTimestamp(generatedAt)}</span>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          onClick={() => onOpenTask(insight.task_id)}
        >
          Open task <ExternalLinkIcon size={13} />
        </button>
      </div>
    </aside>
  );
}
