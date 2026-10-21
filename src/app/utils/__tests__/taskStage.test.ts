import { describe, expect, it } from 'vitest';

import {
  agentName,
  describeTaskStage,
  getRunStage,
  getTaskStage,
  isRunExecuting,
} from '../taskStage';

describe('getTaskStage', () => {
  it('starts a fresh task at Captured', () => {
    expect(getTaskStage({ taskStatus: 'pending', inboxState: 'none' })).toEqual({
      stage: 'capture',
      exception: null,
      cancelled: false,
    });
  });

  it('puts a plan being written or waiting for approval at Plan', () => {
    for (const planStatus of ['generating', 'draft', 'stale', 'applying'] as const) {
      expect(getTaskStage({ taskStatus: 'pending', planStatus }).stage).toBe('plan');
    }
    expect(getTaskStage({ taskStatus: 'pending', inboxState: 'plan_ready' }).stage).toBe('plan');
    expect(getTaskStage({ taskStatus: 'pending', planStatus: 'failed' })).toMatchObject({
      stage: 'plan',
      exception: 'failed',
    });
  });

  it('puts every live run state at Run', () => {
    for (const runStatus of ['queued', 'starting', 'running'] as const) {
      expect(getTaskStage({ taskStatus: 'in_progress', runStatus })).toMatchObject({
        stage: 'run',
        exception: null,
      });
    }
  });

  it('shows the two exceptions as badges on the current step', () => {
    expect(getTaskStage({ taskStatus: 'in_progress', runStatus: 'waiting_input' })).toMatchObject({
      stage: 'run',
      exception: 'needs_input',
    });
    expect(getTaskStage({ taskStatus: 'in_progress', runStatus: 'failed' })).toMatchObject({
      stage: 'run',
      exception: 'failed',
    });
  });

  it('puts a result waiting on a person at Review', () => {
    expect(getTaskStage({ taskStatus: 'in_progress', runStatus: 'waiting_review' }).stage).toBe(
      'review',
    );
    expect(getTaskStage({ taskStatus: 'in_progress', pendingReviewCount: 1 }).stage).toBe('review');
  });

  it('lets a closed task win over a stale run status', () => {
    expect(getTaskStage({ taskStatus: 'completed', runStatus: 'running' }).stage).toBe('done');
    expect(getTaskStage({ taskStatus: 'cancelled' })).toEqual({
      stage: 'done',
      exception: null,
      cancelled: true,
    });
  });

  it('treats a task being worked through its sub-tasks as running', () => {
    expect(getTaskStage({ taskStatus: 'pending', hasSubtasks: true }).stage).toBe('run');
    expect(getTaskStage({ taskStatus: 'pending', planStatus: 'applied' }).stage).toBe('run');
  });
});

describe('getRunStage', () => {
  it('ends an adopted run at Done and a rejected one failed at Review', () => {
    expect(getRunStage({ status: 'completed', is_adopted: true }).stage).toBe('done');
    expect(getRunStage({ status: 'completed', is_adopted: false })).toMatchObject({
      stage: 'review',
      exception: 'failed',
    });
    expect(getRunStage({ status: 'cancelled', is_adopted: false }).cancelled).toBe(true);
  });
});

describe('labels', () => {
  it('names the exception before the step and the agent by its product name', () => {
    expect(describeTaskStage({ stage: 'run', exception: 'needs_input', cancelled: false })).toBe(
      'Needs input',
    );
    expect(describeTaskStage({ stage: 'review', exception: null, cancelled: false })).toBe(
      'Review',
    );
    expect(agentName('claude_code')).toBe('Claude');
    expect(agentName('codex_cli')).toBe('Codex');
  });
});

describe('isRunExecuting', () => {
  it('is true only while a run is queued, starting or running', () => {
    expect(['queued', 'starting', 'running'].every(isRunExecuting)).toBe(true);
    for (const status of ['waiting_input', 'waiting_review', 'completed', 'failed', 'cancelled']) {
      expect(isRunExecuting(status)).toBe(false);
    }
    expect(isRunExecuting(null)).toBe(false);
    expect(isRunExecuting(undefined)).toBe(false);
  });
});
