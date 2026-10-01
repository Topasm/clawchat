import { useMemo, useState } from 'react';
import RunCard, { isUnsuccessfulRun } from './RunCard';
import CliSessionsPanel from './CliSessionsPanel';
import EmptyState from '../shared/EmptyState';
import { SpinArrowsIcon } from '../shared/Icons';
import { useAgentRunsQuery } from '../../hooks/queries';
import type { AgentRunResponse } from '../../types/api';
import { translateUi } from '../../i18n';
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
  return isUnsuccessfulRun(run);
}
interface RunsLogProps {
  projectId: string | null;
  /** The run to open on arrival, from a `run_id` deep link. */
  selectedRunId: string | null;
  onReview: (run: AgentRunResponse) => void;
}
/** The full execution log: CLI sessions plus every run attempt, filterable. */
export default function RunsLog({ projectId, selectedRunId, onReview }: RunsLogProps) {
  const { data: runs = [], isLoading } = useAgentRunsQuery(projectId);
  const [filter, setFilter] = useState<RunFilter>('all');
  const [expandedRun, setExpandedRun] = useState<string | null>(selectedRunId);
  const filtered = useMemo(() => runs.filter((run) => matchesFilter(run, filter)), [filter, runs]);
  return (
    <>
      <CliSessionsPanel />
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
              onReview={() => onReview(run)}
            />
          ))}
        </div>
      )}
    </>
  );
}
