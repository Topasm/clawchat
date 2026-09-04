import type { AgentRunReviewOutcome, ReviewItemResponse } from '../types/api';
import { AgentRunApprovalImpactSchema } from '../types/schemas';

export type ReviewDecision = 'approved' | 'changes_requested' | 'rejected';

export interface ApprovedAgentRunHandoff {
  reviewId: string;
  projectId: string | null;
  taskTitle: string | null;
  outcome: AgentRunReviewOutcome;
}

interface AgentRunDecisionResult {
  review: ReviewItemResponse;
  agentRunOutcome: AgentRunReviewOutcome | null;
}

export function agentRunApprovalImpact(item: ReviewItemResponse) {
  if (item.subject_type !== 'agent_run') return null;
  const parsed = AgentRunApprovalImpactSchema.safeParse(item.metadata.approval_impact);
  return parsed.success ? parsed.data : null;
}

export function approvedAgentRunHandoff(
  item: ReviewItemResponse,
  result: AgentRunDecisionResult,
): ApprovedAgentRunHandoff | null {
  if (item.subject_type !== 'agent_run') return null;
  const impact = agentRunApprovalImpact(item);
  if (!result.agentRunOutcome && !impact) return null;
  return {
    reviewId: item.id,
    projectId: result.review.project_id ?? item.project_id,
    taskTitle: result.review.subject_title ?? item.subject_title,
    outcome: {
      ...(result.agentRunOutcome ?? {}),
      todo_id: result.agentRunOutcome?.todo_id ?? impact?.todo_id,
      graph_revision: result.agentRunOutcome?.graph_revision ?? impact?.graph_revision,
      newly_ready_tasks: result.agentRunOutcome?.newly_ready_tasks ?? impact?.newly_ready_tasks,
    },
  };
}
