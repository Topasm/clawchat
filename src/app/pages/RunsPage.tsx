import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import EmptyState from '../components/shared/EmptyState';
import { SpinArrowsIcon } from '../components/shared/Icons';
import {
  useAgentRunEventsQuery,
  useAgentRunsQuery,
  useCancelAgentRun,
  useReturnAgentRunToReady,
  useRetryAgentRun,
  useResumeAgentRun,
} from '../hooks/queries';
import type { AgentRunResponse } from '../types/api';

type RunFilter = 'all' | 'active' | 'review' | 'failed';

const FILTERS: Array<{ value: RunFilter; label: string }> = [
  { value: 'all', label: 'All runs' },
  { value: 'active', label: 'Active' },
  { value: 'review', label: 'Waiting review' },
  { value: 'failed', label: 'Failed' },
];

function matchesFilter(run: AgentRunResponse, filter: RunFilter) {
  if (filter === 'all') return true;
  if (filter === 'active')
    return ['queued', 'starting', 'running', 'waiting_input'].includes(run.status);
  if (filter === 'review') return run.status === 'waiting_review';
  return (
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    (run.status === 'completed' && !run.is_adopted)
  );
}

export default function RunsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project_id');
  const selectedRunId = searchParams.get('run_id');
  const { data: runs = [], isLoading } = useAgentRunsQuery(projectId);
  const [filter, setFilter] = useState<RunFilter>('all');
  const [expandedRun, setExpandedRun] = useState<string | null>(selectedRunId);
  const filtered = useMemo(() => runs.filter((run) => matchesFilter(run, filter)), [filter, runs]);

  return (
    <div className="cc-runs-page">
      <header className="cc-page-header cc-runs-page__header">
        <div>
          <h1>Runs</h1>
          <p>Inspect every execution attempt, provider, heartbeat, result, and failure.</p>
        </div>
        {projectId && (
          <button
            type="button"
            className="cc-btn"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            Back to project
          </button>
        )}
      </header>
      <div className="cc-review-filters" aria-label="Run filters">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`cc-review-filter${filter === option.value ? ' cc-review-filter--active' : ''}`}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="cc-project-workspace__loading">Loading runs…</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<SpinArrowsIcon size={28} />} message="No agent runs match this view." />
      ) : (
        <div className="cc-run-list">
          {filtered.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              expanded={expandedRun === run.id}
              onToggle={() => setExpandedRun((current) => (current === run.id ? null : run.id))}
              onReview={() =>
                navigate(`/review${run.project_id ? `?project_id=${run.project_id}` : ''}`)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({
  run,
  expanded,
  onToggle,
  onReview,
}: {
  run: AgentRunResponse;
  expanded: boolean;
  onToggle: () => void;
  onReview: () => void;
}) {
  const cancel = useCancelAgentRun();
  const retry = useRetryAgentRun();
  const returnToReady = useReturnAgentRunToReady();
  const resume = useResumeAgentRun();
  const [followUp, setFollowUp] = useState('');
  const active = ['queued', 'starting', 'running', 'waiting_input'].includes(run.status);
  const unsuccessful =
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    (run.status === 'completed' && !run.is_adopted);
  const canRetry = unsuccessful && (!run.todo_id || run.todo_status === 'in_progress');
  const canReturnToReady = Boolean(
    unsuccessful && run.todo_id && run.todo_status === 'in_progress',
  );

  return (
    <article className={`cc-run-card cc-run-card--${run.status}`}>
      <div className="cc-run-card__header">
        <div className="cc-run-card__identity">
          <span className={`cc-run-status cc-run-status--${run.status}`}>
            {run.status.replaceAll('_', ' ')}
          </span>
          <h2>{run.todo_title || run.instruction_snapshot}</h2>
          <p>
            {run.project_title || 'Unscoped'} · attempt {run.attempt} · {run.provider}
            {run.model ? ` / ${run.model}` : ''}
          </p>
          {run.provider === 'paseo' && (run.host_id || run.workspace_id || run.external_run_id) && (
            <p className="cc-run-card__external">
              {run.host_id || 'Paseo'}
              {run.workspace_id ? ` · workspace ${run.workspace_id}` : ''}
              {run.external_run_id ? ` · agent ${run.external_run_id}` : ''}
            </p>
          )}
        </div>
        {run.is_adopted && <span className="cc-run-card__adopted">Adopted</span>}
      </div>
      <div className="cc-run-progress" aria-label={`${run.progress}% complete`}>
        <span style={{ width: `${run.progress}%` }} />
      </div>
      <div className="cc-run-card__status-line">
        <span>{run.progress_message || 'No progress message'}</span>
        {run.heartbeat_at && (
          <span>Heartbeat {new Date(run.heartbeat_at).toLocaleTimeString()}</span>
        )}
      </div>
      {run.error && <p className="cc-run-card__error">{run.error}</p>}
      {run.result_summary && <pre className="cc-run-card__result">{run.result_summary}</pre>}
      {run.status === 'waiting_input' && (
        <textarea
          rows={2}
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          placeholder="Add follow-up instructions before retrying"
        />
      )}
      <div className="cc-run-card__actions">
        <button type="button" className="cc-btn" onClick={onToggle}>
          {expanded ? 'Hide log' : 'Event log'}
        </button>
        {active && run.status !== 'waiting_input' && (
          <button
            type="button"
            className="cc-btn cc-btn--danger"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(run.id)}
          >
            Cancel
          </button>
        )}
        {run.status === 'waiting_input' && (
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={resume.isPending || !followUp.trim()}
            onClick={() => resume.mutate({ runId: run.id, followUp })}
          >
            Resume with follow-up
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ runId: run.id })}
          >
            Retry
          </button>
        )}
        {canReturnToReady && (
          <button
            type="button"
            className="cc-btn"
            disabled={returnToReady.isPending}
            onClick={() => returnToReady.mutate(run.id)}
          >
            Return task to queue
          </button>
        )}
        {run.status === 'waiting_review' && (
          <button type="button" className="cc-btn cc-btn--primary" onClick={onReview}>
            Review result
          </button>
        )}
      </div>
      {expanded && <RunEventLog runId={run.id} />}
    </article>
  );
}

function RunEventLog({ runId }: { runId: string }) {
  const { data: events = [], isLoading } = useAgentRunEventsQuery(runId);
  if (isLoading) return <div className="cc-run-events">Loading event log…</div>;
  return (
    <ol className="cc-run-events">
      {events.map((event) => (
        <li key={event.id}>
          <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleTimeString()}</time>
          <strong>{event.event_type.replaceAll('_', ' ')}</strong>
          <span>{event.message || (event.progress != null ? `${event.progress}%` : '')}</span>
        </li>
      ))}
    </ol>
  );
}
