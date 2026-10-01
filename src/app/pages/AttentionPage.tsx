import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AgentRunReviewOutcomeHandoff from '../components/review/AgentRunReviewOutcomeHandoff';
import ReviewHistory from '../components/review/ReviewHistory';
import ReviewItemCard from '../components/review/ReviewItemCard';
import RunCard, { needsRecoveryDecision } from '../components/runs/RunCard';
import RunsLog from '../components/runs/RunsLog';
import EmptyState from '../components/shared/EmptyState';
import { CheckCircleIcon } from '../components/shared/Icons';
import { useAgentRunsQuery, useReviewsQuery, useRunsAwaitingInputQuery } from '../hooks/queries';
import useReviewDecisionHandoff from '../hooks/useReviewDecisionHandoff';
import type { ReviewStatus } from '../types/api';
import { translateUi } from '../i18n';

const EXECUTING = new Set(['queued', 'starting', 'running']);
type AttentionView = 'now' | 'runs' | 'history';
const VIEWS: Array<{ value: AttentionView; label: string }> = [
  { value: 'now', label: 'Needs you' },
  { value: 'runs', label: 'All runs' },
  { value: 'history', label: 'Review history' },
];
function parseView(value: string | null): AttentionView {
  return value === 'runs' || value === 'history' ? value : 'now';
}
const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'changes_requested', 'approved', 'rejected'];

/**
 * Everything agents stopped on, in one place.
 *
 * The default view lists only what needs a person -- a question to answer, a
 * result to review, a failed run to decide on -- and lets each be acted on in
 * place. The run log and the review history used to be pages of their own;
 * they are the other two views here, so there is one place to look.
 */
export default function AttentionPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('project_id');
  const view = parseView(searchParams.get('view'));
  const requestedStatus = searchParams.get('status') as ReviewStatus | null;
  const historyStatus: ReviewStatus =
    requestedStatus && REVIEW_STATUSES.includes(requestedStatus) ? requestedStatus : 'approved';
  const { data: awaitingInput = [], isLoading: loadingInput } = useRunsAwaitingInputQuery();
  const { data: reviews = [], isLoading: loadingReviews } = useReviewsQuery('pending', projectId);
  const { data: runs = [], isLoading: loadingRuns } = useAgentRunsQuery(projectId);
  const { approvedAgentRun, decide, decideItem, dismissApprovedAgentRun } =
    useReviewDecisionHandoff();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const questions = useMemo(
    () => awaitingInput.filter((run) => !projectId || run.project_id === projectId),
    [awaitingInput, projectId],
  );
  const pendingReviews = useMemo(
    () => reviews.filter((item) => item.id !== approvedAgentRun?.reviewId),
    [approvedAgentRun?.reviewId, reviews],
  );
  const decisions = useMemo(() => runs.filter(needsRecoveryDecision), [runs]);
  const executingCount = useMemo(
    () => runs.filter((run) => EXECUTING.has(run.status)).length,
    [runs],
  );
  const isLoading = loadingInput || loadingReviews || loadingRuns;
  const total = questions.length + pendingReviews.length + decisions.length;

  const toggleRun = (runId: string) =>
    setExpandedRun((current) => (current === runId ? null : runId));
  const updateParams = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next);
  };
  const showView = (next: AttentionView) =>
    updateParams((params) => {
      if (next === 'now') params.delete('view');
      else params.set('view', next);
      params.delete('run_id');
    });

  return (
    <div className="cc-review-page cc-attention-page">
      <header className="cc-page-header cc-review-page__header">
        <div>
          <h1 className="cc-page-header__title">{translateUi('Attention')}</h1>
          <p className="cc-page-header__subtitle">
            {translateUi(
              'Questions from agents, results to review, and runs that need a decision.',
            )}
          </p>
        </div>
        {projectId && (
          <div className="cc-page-header__actions">
            <button
              type="button"
              className="cc-btn"
              onClick={() => navigate(`/projects/${projectId}`)}
            >
              {translateUi('Back to project')}
            </button>
          </div>
        )}
      </header>

      <div
        className="cc-attention-views"
        role="tablist"
        aria-label={translateUi('Attention views')}
      >
        {VIEWS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={view === option.value}
            className={`cc-attention-view${view === option.value ? ' cc-attention-view--active' : ''}`}
            onClick={() => showView(option.value)}
          >
            {translateUi(option.label)}
            {option.value === 'now' && !isLoading && total > 0 && (
              <span className="cc-section__count">{total}</span>
            )}
          </button>
        ))}
      </div>

      {approvedAgentRun && (
        <AgentRunReviewOutcomeHandoff
          projectId={approvedAgentRun.projectId}
          taskTitle={approvedAgentRun.taskTitle}
          outcome={approvedAgentRun.outcome}
          onDismiss={dismissApprovedAgentRun}
        />
      )}

      {view === 'runs' && (
        <RunsLog
          projectId={projectId}
          selectedRunId={searchParams.get('run_id')}
          onReview={() => showView('now')}
        />
      )}

      {view === 'history' && (
        <ReviewHistory
          status={historyStatus}
          onStatusChange={(status) => updateParams((params) => params.set('status', status))}
          projectId={projectId}
          hiddenReviewId={approvedAgentRun?.reviewId}
          onDecide={decideItem}
          isDeciding={decide.isPending}
        />
      )}

      {view === 'now' &&
        (isLoading ? (
          <div className="cc-project-workspace__loading">{translateUi('Loading…')}</div>
        ) : total === 0 ? (
          <EmptyState
            icon={<CheckCircleIcon size={28} />}
            message={
              executingCount > 0
                ? translateUi('Nothing needs you right now. {{count}} runs in progress.', {
                    count: executingCount,
                  })
                : translateUi('Nothing needs you right now.')
            }
          />
        ) : (
          <>
            {questions.length > 0 && (
              <section
                className="cc-attention-section"
                aria-label={translateUi('Needs your input')}
              >
                <h2 className="cc-attention-section__title">
                  {translateUi('Needs your input')}
                  <span className="cc-section__count">{questions.length}</span>
                </h2>
                <div className="cc-run-list">
                  {questions.map((run) => (
                    <RunCard
                      key={run.id}
                      run={run}
                      expanded={expandedRun === run.id}
                      onToggle={() => toggleRun(run.id)}
                      onReview={() => undefined}
                    />
                  ))}
                </div>
              </section>
            )}
            {pendingReviews.length > 0 && (
              <section
                className="cc-attention-section"
                aria-label={translateUi('Needs your review')}
              >
                <h2 className="cc-attention-section__title">
                  {translateUi('Needs your review')}
                  <span className="cc-section__count">{pendingReviews.length}</span>
                </h2>
                <div className="cc-review-list">
                  {pendingReviews.map((item) => (
                    <ReviewItemCard
                      key={item.id}
                      item={item}
                      note={notes[item.id] ?? ''}
                      onNoteChange={(note) =>
                        setNotes((current) => ({ ...current, [item.id]: note }))
                      }
                      onDecide={(decision) => decideItem(item, decision, notes[item.id])}
                      isDeciding={decide.isPending}
                    />
                  ))}
                </div>
              </section>
            )}
            {decisions.length > 0 && (
              <section
                className="cc-attention-section"
                aria-label={translateUi('Needs a decision')}
              >
                <h2 className="cc-attention-section__title">
                  {translateUi('Needs a decision')}
                  <span className="cc-section__count">{decisions.length}</span>
                </h2>
                <div className="cc-run-list">
                  {decisions.map((run) => (
                    <RunCard
                      key={run.id}
                      run={run}
                      expanded={expandedRun === run.id}
                      onToggle={() => toggleRun(run.id)}
                      onReview={() => undefined}
                    />
                  ))}
                </div>
              </section>
            )}
            {executingCount > 0 && (
              <p className="cc-attention-page__footnote">
                {translateUi('{{count}} runs in progress.', { count: executingCount })}
              </p>
            )}
          </>
        ))}
    </div>
  );
}
