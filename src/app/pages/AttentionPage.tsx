import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AgentRunReviewOutcomeHandoff from '../components/review/AgentRunReviewOutcomeHandoff';
import ReviewItemCard from '../components/review/ReviewItemCard';
import RunCard, { needsRecoveryDecision } from '../components/runs/RunCard';
import EmptyState from '../components/shared/EmptyState';
import { CheckCircleIcon } from '../components/shared/Icons';
import { useAgentRunsQuery, useReviewsQuery, useRunsAwaitingInputQuery } from '../hooks/queries';
import useReviewDecisionHandoff from '../hooks/useReviewDecisionHandoff';
import { translateUi } from '../i18n';

const EXECUTING = new Set(['queued', 'starting', 'running']);

/**
 * Everything that has stopped for the user, in one place.
 *
 * The Runs log and the Review inbox used to be the two places to find out
 * that an agent was waiting. This page lists only what needs a person --
 * a question to answer, a result to review, a failed run to decide on --
 * and links each item to its thread; the log and the history stay a click
 * away for everything else.
 */
export default function AttentionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project_id');
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
  const projectQuery = projectId ? `?project_id=${projectId}` : '';

  return (
    <div className="cc-review-page cc-attention-page">
      <header className="cc-page-header cc-review-page__header">
        <div>
          <h1>{translateUi('Attention')}</h1>
          <p>
            {translateUi(
              'Questions from agents, results to review, and runs that need a decision.',
            )}
          </p>
        </div>
        <div className="cc-page-header__actions">
          <button type="button" className="cc-btn" onClick={() => navigate(`/runs${projectQuery}`)}>
            {translateUi('All runs')}
          </button>
          <button
            type="button"
            className="cc-btn"
            onClick={() =>
              navigate(`/review?status=approved${projectId ? `&project_id=${projectId}` : ''}`)
            }
          >
            {translateUi('Review history')}
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

      {approvedAgentRun && (
        <AgentRunReviewOutcomeHandoff
          projectId={approvedAgentRun.projectId}
          taskTitle={approvedAgentRun.taskTitle}
          outcome={approvedAgentRun.outcome}
          onDismiss={dismissApprovedAgentRun}
        />
      )}

      {isLoading ? (
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
            <section className="cc-attention-section" aria-label={translateUi('Needs your input')}>
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
            <section className="cc-attention-section" aria-label={translateUi('Needs your review')}>
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
            <section className="cc-attention-section" aria-label={translateUi('Needs a decision')}>
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
      )}
    </div>
  );
}
