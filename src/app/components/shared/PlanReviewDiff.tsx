import { useState } from 'react';
import type { PlanProposalResponse } from '../../types/api';
import { getPlanProposalMutationError, isStalePlanProposalError } from '../../hooks/queries';
import { toggleProposalSelection } from '../task-graph/taskGraphProposal';
import Badge from './Badge';

interface PlanReviewDiffProps {
  plan: PlanProposalResponse;
  onApply: (selectedIndices: number[]) => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
  applyError?: unknown;
  isApplying?: boolean;
  isDismissing?: boolean;
  isRegenerating?: boolean;
  compact?: boolean;
}

export default function PlanReviewDiff({
  plan,
  onApply,
  onDismiss,
  onRegenerate,
  applyError,
  isApplying,
  isDismissing,
  isRegenerating,
  compact,
}: PlanReviewDiffProps) {
  const subtasks = plan.subtasks;
  const [selection, setSelection] = useState<{
    proposalId: string;
    indices: Set<number>;
  }>(() => ({
    proposalId: plan.proposal_id,
    indices: new Set(subtasks.map((_, index) => index)),
  }));
  const selected =
    selection.proposalId === plan.proposal_id
      ? selection.indices
      : new Set(subtasks.map((_, index) => index));

  const toggleIndex = (index: number) => {
    setSelection((current) => ({
      proposalId: plan.proposal_id,
      indices: toggleProposalSelection(
        subtasks,
        current.proposalId === plan.proposal_id
          ? current.indices
          : new Set(subtasks.map((_, candidateIndex) => candidateIndex)),
        index,
      ),
    }));
  };

  const stale = Boolean(
    plan.status === 'stale' || (applyError && isStalePlanProposalError(applyError)),
  );
  const normalizedApplyError = applyError ? getPlanProposalMutationError(applyError) : undefined;
  const legacyProposal = plan.base_graph_revision === null;
  const invalidProposal = plan.validation.errors.length > 0;
  const canApply =
    plan.status === 'draft' && !legacyProposal && !invalidProposal && !stale && selected.size > 0;

  const handleApply = () => {
    const indices = [...selected].sort((left, right) => left - right);
    void Promise.resolve(onApply(indices)).catch(() => undefined);
  };

  return (
    <div className={`cc-plan-review${compact ? ' cc-plan-review--compact' : ''}`}>
      {plan.summary && <p className="cc-plan-review__summary">{plan.summary}</p>}

      <div className="cc-plan-review__stats" aria-label="Authoritative proposal diff">
        <span className="cc-plan-review__stat">
          {plan.diff.add_task_count} task{plan.diff.add_task_count === 1 ? '' : 's'} to add
        </span>
        <span className="cc-plan-review__stat">
          {plan.diff.add_relationship_count} dependenc
          {plan.diff.add_relationship_count === 1 ? 'y' : 'ies'} to add
        </span>
        {plan.diff.root_update_fields.length > 0 && (
          <span className="cc-plan-review__stat">
            Root updates: {plan.diff.root_update_fields.join(', ')}
          </span>
        )}
      </div>

      {(plan.validation.errors.length > 0 || plan.validation.warnings.length > 0) && (
        <div className="cc-plan-review__validation" aria-label="Proposal validation">
          {plan.validation.errors.map((issue, index) => (
            <div key={`error-${issue.code}-${index}`} role="alert">
              <strong>Cannot apply:</strong> {issue.message}
            </div>
          ))}
          {plan.validation.warnings.map((issue, index) => (
            <div key={`warning-${issue.code}-${index}`}>
              <strong>Review:</strong> {issue.message}
            </div>
          ))}
        </div>
      )}

      {legacyProposal && (
        <div className="cc-plan-review__conflict" role="alert">
          <span>This older proposal cannot be applied safely. Generate a revision-aware plan.</span>
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => void Promise.resolve(onRegenerate()).catch(() => undefined)}
            disabled={isRegenerating}
          >
            {isRegenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      )}

      {!legacyProposal && stale && (
        <div className="cc-plan-review__conflict" role="alert">
          <span>
            <strong>The task graph changed after this proposal was created.</strong>
            {!normalizedApplyError?.staleDetails && (
              <> Regenerate it from the current graph before applying.</>
            )}
            {normalizedApplyError?.staleDetails && (
              <>
                {' '}
                Revision {normalizedApplyError.staleDetails.base_revision ?? 'unknown'} →{' '}
                {normalizedApplyError.staleDetails.current_revision}.
              </>
            )}
          </span>
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => void Promise.resolve(onRegenerate()).catch(() => undefined)}
            disabled={isRegenerating}
          >
            {isRegenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      )}

      {subtasks.length > 0 && (
        <div className="cc-plan-review__subtasks">
          {subtasks.map((subtask, index) => (
            <label key={index} className="cc-plan-review__subtask">
              <input
                type="checkbox"
                checked={selected.has(index)}
                onChange={() => toggleIndex(index)}
                className="cc-plan-review__checkbox"
              />
              <div className="cc-plan-review__subtask-body">
                <span className="cc-plan-review__subtask-title">{subtask.title}</span>
                <span className="cc-plan-review__subtask-meta">
                  {subtask.estimated_minutes && <span>{subtask.estimated_minutes}m</span>}
                  {subtask.due_date && <Badge variant="due" dueDate={subtask.due_date} />}
                  {(subtask.depends_on_indices?.length ?? 0) > 0 && (
                    <span>
                      {subtask.depends_on_indices!.length} prerequisite
                      {subtask.depends_on_indices!.length === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="cc-plan-review__actions">
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          style={{ fontSize: 12 }}
          onClick={handleApply}
          disabled={!canApply || isApplying || isDismissing || isRegenerating}
        >
          {isApplying ? 'Applying…' : `Apply (${selected.size}/${subtasks.length})`}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--ghost"
          style={{ fontSize: 12 }}
          onClick={() => void Promise.resolve(onDismiss()).catch(() => undefined)}
          disabled={isApplying || isDismissing || isRegenerating}
        >
          {isDismissing ? 'Dismissing…' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}
