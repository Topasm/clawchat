import { useNavigate } from 'react-router-dom';
import { useRunReadyTaskWithProjectDefaults } from '../../hooks/queries';
import type { AgentRunReviewOutcome } from '../../types/api';
import AgentRunReviewHandoff from './AgentRunReviewHandoff';

interface AgentRunReviewOutcomeHandoffProps {
  projectId?: string | null;
  taskTitle?: string | null;
  outcome: AgentRunReviewOutcome;
  onDismiss: () => void;
}

/** The small, explicit handoff from an approved result to one next Ready task. */
export default function AgentRunReviewOutcomeHandoff({
  projectId,
  taskTitle,
  outcome,
  onDismiss,
}: AgentRunReviewOutcomeHandoffProps) {
  const navigate = useNavigate();
  const nextTask = outcome.newly_ready_tasks?.[0];
  const runner = useRunReadyTaskWithProjectDefaults(Boolean(nextTask));

  return (
    <AgentRunReviewHandoff
      taskTitle={taskTitle}
      outcome={outcome}
      onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
      onRunNext={(task) => runner.runTask(task.id, projectId)}
      canRunNext={Boolean(nextTask && runner.canRunTask(nextTask.id, projectId))}
      isStartingNext={runner.isPending || runner.isPreparing}
      onChooseAnother={() =>
        projectId
          ? navigate(`/projects/${projectId}`)
          : nextTask
            ? navigate(`/tasks/${nextTask.id}`)
            : undefined
      }
      onStop={onDismiss}
      onOpenRun={(runId) => navigate(`/runs?run_id=${runId}`)}
    />
  );
}
