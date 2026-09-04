import { useState } from 'react';
import { useDecideReview } from './queries';
import type { ReviewItemResponse } from '../types/api';
import {
  approvedAgentRunHandoff,
  type ApprovedAgentRunHandoff,
  type ReviewDecision,
} from '../utils/agentRunReview';

/** Keep review mutation and the post-approval Ready-task handoff consistent. */
export default function useReviewDecisionHandoff() {
  const decide = useDecideReview();
  const [approvedAgentRun, setApprovedAgentRun] = useState<ApprovedAgentRunHandoff | null>(null);

  const decideItem = (item: ReviewItemResponse, decision: ReviewDecision, note?: string) => {
    const variables = {
      reviewId: item.id,
      decision,
      note: note?.trim() || undefined,
    };
    if (decision !== 'approved') {
      decide.mutate(variables);
      return;
    }
    decide.mutate(variables, {
      onSuccess: (result) => {
        const handoff = approvedAgentRunHandoff(item, result);
        if (handoff) setApprovedAgentRun(handoff);
      },
    });
  };

  return {
    approvedAgentRun,
    decide,
    decideItem,
    dismissApprovedAgentRun: () => setApprovedAgentRun(null),
  };
}
