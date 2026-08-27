import { useMemo, useState } from 'react';
import type { PlanProposalResponse, PlanSubtask, TodoResponse } from '../../types/api';
import {
  getPlanProposalMutationError,
  isStalePlanProposalError,
  useApplyPlanProposal,
  useGeneratePlanProposal,
} from '../../hooks/queries';
import usePlatform from '../../hooks/usePlatform';
import Dialog from '../shared/Dialog';
import SegmentedControl from '../shared/SegmentedControl';
import TaskGraphView from './TaskGraphView';
import { buildTaskGraphElements } from './taskGraphAdapter';
import type { TaskGraphMode } from './taskGraphTypes';
import {
  buildProposalRelationships,
  buildProposalTodos,
  PROPOSAL_ROOT_ID,
  proposalIndexFromNodeId,
  toggleProposalSelection,
} from './taskGraphProposal';

interface TaskGraphProposalDialogProps {
  targets: TodoResponse[];
  initialTargetId?: string;
  onOpenChange: (open: boolean) => void;
}

const MODE_OPTIONS = [
  { label: 'Structure', value: 'structure' },
  { label: 'Execution', value: 'execution' },
];

export default function TaskGraphProposalDialog({
  targets,
  initialTargetId,
  onOpenChange,
}: TaskGraphProposalDialogProps) {
  const { isMobile } = usePlatform();
  const generatePlan = useGeneratePlanProposal();
  const applyPlan = useApplyPlanProposal();
  const defaultTarget = targets.some((target) => target.id === initialTargetId)
    ? initialTargetId!
    : (targets[0]?.id ?? '');
  const [targetId, setTargetId] = useState(defaultTarget);
  const [instructions, setInstructions] = useState('');
  const [plan, setPlan] = useState<PlanProposalResponse | null>(null);
  const [draftSubtasks, setDraftSubtasks] = useState<PlanSubtask[]>([]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [mode, setMode] = useState<TaskGraphMode>('execution');

  const target = targets.find((candidate) => candidate.id === targetId) ?? targets[0];
  const preview = useMemo(() => {
    if (!target || !plan) return { nodes: [], edges: [] };
    const todos = buildProposalTodos(target, draftSubtasks);
    const relationships = buildProposalRelationships(draftSubtasks);
    const elements = buildTaskGraphElements(todos, {
      mode,
      collapsedIds: new Set(),
      hideCompleted: false,
      relationships,
      metadataTodos: todos,
      onToggleCollapse: () => undefined,
    });
    return {
      ...elements,
      nodes: elements.nodes.map((node) => {
        const index = proposalIndexFromNodeId(node.id);
        return {
          ...node,
          data: {
            ...node.data,
            proposalSelection:
              node.id === PROPOSAL_ROOT_ID
                ? ('fixed' as const)
                : index !== null && selected.has(index)
                  ? ('selected' as const)
                  : ('excluded' as const),
          },
        };
      }),
    };
  }, [draftSubtasks, mode, plan, selected, target]);

  const handleGenerate = async () => {
    if (!targetId) return;
    try {
      const nextPlan = await generatePlan.mutateAsync({ todoId: targetId, instructions });
      const subtasks = nextPlan.subtasks;
      setPlan(nextPlan);
      setDraftSubtasks(subtasks);
      setSelected(new Set(subtasks.map((_, index) => index)));
      applyPlan.reset();
    } catch {
      // The mutation owns error feedback; keep the current proposal available.
    }
  };

  const toggleSelection = (index: number) => {
    setSelected((current) => toggleProposalSelection(draftSubtasks, current, index));
  };

  const updateSubtask = (index: number, updates: Partial<PlanSubtask>) => {
    setDraftSubtasks((current) =>
      current.map((subtask, candidateIndex) =>
        candidateIndex === index ? { ...subtask, ...updates } : subtask,
      ),
    );
  };

  const handleApply = async () => {
    if (!targetId || !plan || plan.base_graph_revision === null || selected.size === 0) return;
    try {
      await applyPlan.mutateAsync({
        todoId: targetId,
        proposalId: plan.proposal_id,
        baseGraphRevision: plan.base_graph_revision,
        selectedIndices: [...selected].sort((a, b) => a - b),
        subtasks: draftSubtasks,
      });
      onOpenChange(false);
    } catch {
      // A stale proposal must remain open so the user can inspect and regenerate it.
    }
  };

  const hasInvalidTitle = draftSubtasks.some(
    (subtask, index) => selected.has(index) && !subtask.title.trim(),
  );
  const applyError = applyPlan.error ? getPlanProposalMutationError(applyPlan.error) : undefined;
  const isStale = Boolean(
    plan?.status === 'stale' || (applyPlan.error && isStalePlanProposalError(applyPlan.error)),
  );
  const hasServerValidationErrors = (plan?.validation.errors.length ?? 0) > 0;
  const isLegacyProposal = plan?.base_graph_revision === null;
  const canApplyProposal = plan?.status === 'draft';

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="AI task graph proposal"
      className="cc-task-proposal"
    >
      <div className="cc-task-proposal__setup">
        <label>
          <span>Goal or project</span>
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={Boolean(plan)}
          >
            {targets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select>
        </label>
        <label className="cc-task-proposal__guidance">
          <span>
            Guidance for AI <small>optional</small>
          </span>
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Example: Break this into 6 concrete tasks and keep research before implementation."
            maxLength={2000}
            disabled={generatePlan.isPending}
          />
        </label>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          onClick={() => void handleGenerate()}
          disabled={!targetId || generatePlan.isPending || applyPlan.isPending}
        >
          {generatePlan.isPending ? 'AI is planning…' : plan ? 'Regenerate' : 'Generate proposal'}
        </button>
      </div>

      {generatePlan.isPending && (
        <div className="cc-task-proposal__loading" role="status">
          <span className="cc-task-proposal__spinner" />
          Reading the goal, existing tasks, and schedule context…
        </div>
      )}

      {plan && !generatePlan.isPending && (
        <>
          <div className="cc-task-proposal__diff" aria-label="Authoritative proposal diff">
            <span>
              {plan.diff.add_task_count} task{plan.diff.add_task_count === 1 ? '' : 's'} to add
            </span>
            <span>
              {plan.diff.add_relationship_count} dependenc
              {plan.diff.add_relationship_count === 1 ? 'y' : 'ies'} to add
            </span>
            {plan.diff.root_update_fields.length > 0 && (
              <span>Root updates: {plan.diff.root_update_fields.join(', ')}</span>
            )}
          </div>

          {(plan.validation.errors.length > 0 || plan.validation.warnings.length > 0) && (
            <div className="cc-task-proposal__validation" aria-label="Proposal validation">
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

          {isLegacyProposal && (
            <div className="cc-task-proposal__conflict" role="alert">
              This older proposal has no graph revision and cannot be applied safely.
              <button
                type="button"
                className="cc-btn cc-btn--ghost"
                onClick={() => void handleGenerate()}
              >
                Regenerate
              </button>
            </div>
          )}

          {!isLegacyProposal && isStale && (
            <div className="cc-task-proposal__conflict" role="alert">
              <div>
                <strong>The task graph changed after this proposal was created.</strong>
                {!applyError?.staleDetails && (
                  <span>Regenerate it from the current graph before applying.</span>
                )}
                {applyError?.staleDetails && (
                  <span>
                    Proposal revision {applyError.staleDetails.base_revision ?? 'unknown'} · current
                    revision {applyError.staleDetails.current_revision}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="cc-btn cc-btn--ghost"
                onClick={() => void handleGenerate()}
              >
                Regenerate
              </button>
            </div>
          )}

          <div className="cc-task-proposal__heading">
            <div>
              <strong>{plan.summary || 'Proposed task structure'}</strong>
              <span>
                {selected.size}/{draftSubtasks.length} tasks selected · dependencies stay valid
                automatically
              </span>
            </div>
            <SegmentedControl
              ariaLabel="Proposal graph mode"
              options={MODE_OPTIONS}
              value={mode}
              onChange={(value) => setMode(value as TaskGraphMode)}
            />
          </div>

          {draftSubtasks.length > 0 ? (
            <div className="cc-task-proposal__workspace">
              <div className="cc-task-proposal__graph">
                <TaskGraphView
                  nodes={preview.nodes}
                  edges={preview.edges}
                  isMobile={isMobile}
                  onSelectTask={(nodeId) => {
                    if (!nodeId) return;
                    const index = proposalIndexFromNodeId(nodeId);
                    if (index !== null) toggleSelection(index);
                  }}
                />
              </div>
              <div className="cc-task-proposal__list" aria-label="Proposed tasks">
                {draftSubtasks.map((subtask, index) => (
                  <div
                    key={index}
                    className={`cc-task-proposal__item${selected.has(index) ? '' : ' cc-task-proposal__item--excluded'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(index)}
                      onChange={() => toggleSelection(index)}
                      aria-label={`Include ${subtask.title}`}
                    />
                    <div>
                      <input
                        className="cc-task-proposal__title-input"
                        value={subtask.title}
                        onChange={(event) => updateSubtask(index, { title: event.target.value })}
                        aria-label={`Title for proposed task ${index + 1}`}
                      />
                      <div className="cc-task-proposal__item-meta">
                        <select
                          value={subtask.priority ?? 'medium'}
                          onChange={(event) =>
                            updateSubtask(index, {
                              priority: event.target.value as PlanSubtask['priority'],
                            })
                          }
                          aria-label={`Priority for ${subtask.title}`}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                        {subtask.estimated_minutes ? (
                          <span>{subtask.estimated_minutes}m</span>
                        ) : null}
                        {(subtask.depends_on_indices?.length ?? 0) > 0 && (
                          <span>
                            {subtask.depends_on_indices!.length} prerequisite
                            {subtask.depends_on_indices!.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="cc-task-proposal__empty">
              AI did not return any actionable tasks. Add more guidance and regenerate.
            </div>
          )}

          <div className="cc-task-proposal__actions">
            <button
              type="button"
              className="cc-btn cc-btn--ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={() => void handleApply()}
              disabled={
                selected.size === 0 ||
                hasInvalidTitle ||
                hasServerValidationErrors ||
                isLegacyProposal ||
                !canApplyProposal ||
                isStale ||
                applyPlan.isPending
              }
            >
              {applyPlan.isPending ? 'Creating tasks…' : `Approve and create ${selected.size}`}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
