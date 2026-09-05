import { useNavigate } from 'react-router-dom';
import { useRunReadyTaskWithProjectDefaults } from '../../hooks/queries';
import type { AgentRunReviewOutcome } from '../../types/api';
import AgentRunReviewHandoff from './AgentRunReviewHandoff';
import useOpenRunThread from '../../hooks/useOpenRunThread';
import { useOptionalChatPanelController } from '../chat-panel/ChatPanelControllerContext';

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
  const openRunThread = useOpenRunThread();
  const panel = useOptionalChatPanelController();
  const nextTask =
    outcome.newly_ready_tasks?.length === 1 ? outcome.newly_ready_tasks[0] : undefined;
  const runner = useRunReadyTaskWithProjectDefaults(Boolean(nextTask));

  return (
    <AgentRunReviewHandoff
      taskTitle={taskTitle}
      outcome={outcome}
      onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
      onRunNext={async (task) => {
        const isCurrentSelection = panel?.beginSelection?.() ?? (() => true);
        const result = await runner.runTask(task.id, projectId);
        if (result && isCurrentSelection()) await openRunThread(result.run_id, task.title);
        return result;
      }}
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
      onOpenRun={(runId) => void openRunThread(runId)}
    />
  );
}
