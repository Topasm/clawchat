import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import RunCard, { isUnsuccessfulRun } from '../components/runs/RunCard';
import EmptyState from '../components/shared/EmptyState';
import { SpinArrowsIcon } from '../components/shared/Icons';
import { useAgentRunsQuery } from '../hooks/queries';
import type { AgentRunResponse } from '../types/api';
import { translateUi } from '../i18n';
type RunFilter = 'all' | 'active' | 'review' | 'failed';
const FILTERS: Array<{
  value: RunFilter;
  label: string;
}> = [
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
  return isUnsuccessfulRun(run);
}
/** The full execution log. What needs the user now lives on the Attention page. */
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
          <h1>{translateUi('Runs')}</h1>
          <p>
            {translateUi(
              'Inspect every execution attempt, provider, heartbeat, result, and failure.',
            )}
          </p>
        </div>
        <div className="cc-page-header__actions">
          <button type="button" className="cc-btn" onClick={() => navigate('/attention')}>
            {translateUi('Attention')}
          </button>
          {projectId && (
            <button
              type="button"
              className="cc-btn"
              onClick={() => navigate(`/projects/${projectId}`)}
            >
              {translateUi('\n            Back to project\n          ')}
            </button>
          )}
        </div>
      </header>
      <div className="cc-review-filters" aria-label={translateUi('Run filters')}>
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`cc-review-filter${filter === option.value ? ' cc-review-filter--active' : ''}`}
            onClick={() => setFilter(option.value)}
          >
            {translateUi(option.label)}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="cc-project-workspace__loading">{translateUi('Loading runs…')}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SpinArrowsIcon size={28} />}
          message={translateUi('No agent runs match this view.')}
        />
      ) : (
        <div className="cc-run-list">
          {filtered.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              expanded={expandedRun === run.id}
              onToggle={() => setExpandedRun((current) => (current === run.id ? null : run.id))}
              onReview={() =>
                navigate(`/attention${run.project_id ? `?project_id=${run.project_id}` : ''}`)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
