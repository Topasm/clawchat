import { describe, expect, it } from 'vitest';
import { reviewPolicy } from '../ReviewItemCard';
import type { ReviewItemResponse } from '../../../types/api';

const item = (metadata: Record<string, unknown>): ReviewItemResponse =>
  ({
    id: 'rev_1',
    subject_type: 'agent_run',
    subject_id: 'run_1',
    status: 'pending',
    summary: 'Review summarize result',
    risk_level: 'low',
    requested_at: '2026-10-24T09:00:00Z',
    metadata,
  }) as ReviewItemResponse;

describe('reviewPolicy', () => {
  it('reads the policy that started a run from the review metadata', () => {
    expect(
      reviewPolicy(
        item({ policy: { project_id: 'proj_1', trigger: 'review_approved', auto_approved: true } }),
      ),
    ).toEqual({ project_id: 'proj_1', trigger: 'review_approved', auto_approved: true });
  });

  it('is absent for a run a person or an automation started', () => {
    expect(reviewPolicy(item({}))).toBeNull();
    expect(reviewPolicy(item({ automation: { scheduled_job_id: 'sjob_1' } }))).toBeNull();
  });
});
