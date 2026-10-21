import type { AgentRunStatus, PlanProposalStatus, TaskStatus } from '../types/api';
import type { InboxState } from '../types/schemas';
import { translateUi } from '../i18n';

/**
 * The five steps a task walks through, as the user sees them.
 *
 * The server keeps eight run states, eight plan states and five review
 * states. None of those are shown as-is: every screen that says where a task
 * is (a list row, the task page, a run card) maps them through this one table
 * so the same task reads the same everywhere.
 */
export type TaskStage = 'capture' | 'plan' | 'run' | 'review' | 'done';

/** Something wrong on top of the current step, shown as a badge on it. */
export type TaskStageException = 'needs_input' | 'failed';

/** Run states in which the agent is at work, or about to be: nothing waits on the user. */
const EXECUTING_RUN_STATUSES: ReadonlySet<string> = new Set<AgentRunStatus>([
  'queued',
  'starting',
  'running',
]);

/** Whether a run is queued, starting or running -- the one test every screen uses. */
export function isRunExecuting(status: string | null | undefined): boolean {
  return status != null && EXECUTING_RUN_STATUSES.has(status);
}

export const TASK_STAGES: readonly TaskStage[] = ['capture', 'plan', 'run', 'review', 'done'];

export interface TaskStageState {
  stage: TaskStage;
  exception: TaskStageException | null;
  /** A closed task that was dropped rather than finished. */
  cancelled: boolean;
}

export interface TaskStageInput {
  taskStatus?: TaskStatus | null;
  inboxState?: InboxState | null;
  planStatus?: PlanProposalStatus | null;
  runStatus?: AgentRunStatus | null;
  pendingReviewCount?: number;
  /** The task has sub-tasks, so an applied plan is being worked through. */
  hasSubtasks?: boolean;
}

const ACTIVE_PLAN = new Set<PlanProposalStatus>(['generating', 'draft', 'stale', 'applying']);
const PLANNING_INBOX = new Set<InboxState>(['questioning', 'planning', 'plan_ready']);

/**
 * Where a task is, most urgent fact first: a closed task is done; an agent
 * waiting on the user or a result waiting for review comes next; then live
 * work, a failure, planning, and only then the plain task status.
 */
export function getTaskStage({
  taskStatus,
  inboxState,
  planStatus,
  runStatus,
  pendingReviewCount = 0,
  hasSubtasks = false,
}: TaskStageInput): TaskStageState {
  const state = (stage: TaskStage, exception: TaskStageException | null = null) => ({
    stage,
    exception,
    cancelled: false,
  });
  if (taskStatus === 'completed') return state('done');
  if (taskStatus === 'cancelled') return { stage: 'done', exception: null, cancelled: true };
  switch (runStatus) {
    case 'waiting_input':
      return state('run', 'needs_input');
    case 'waiting_review':
      return state('review');
  }
  if (pendingReviewCount > 0) return state('review');
  switch (runStatus) {
    case 'queued':
    case 'starting':
    case 'running':
      return state('run');
    case 'failed':
      return state('run', 'failed');
  }
  if (planStatus && ACTIVE_PLAN.has(planStatus)) return state('plan');
  if (planStatus === 'failed') return state('plan', 'failed');
  if (inboxState && PLANNING_INBOX.has(inboxState)) {
    return state('plan', inboxState === 'questioning' ? 'needs_input' : null);
  }
  if (inboxState === 'error') return state('capture', 'failed');
  if (taskStatus === 'in_progress' || hasSubtasks || planStatus === 'applied') return state('run');
  return state('capture');
}

export function taskStageLabel(stage: TaskStage): string {
  switch (stage) {
    case 'capture':
      return translateUi('Captured');
    case 'plan':
      return translateUi('Plan');
    case 'run':
      return translateUi('Run');
    case 'review':
      return translateUi('Review');
    case 'done':
      return translateUi('Done');
  }
}

export function taskStageExceptionLabel(exception: TaskStageException): string {
  return exception === 'needs_input' ? translateUi('Needs input') : translateUi('Failed');
}

/** One short phrase for the whole state, for a list cell or a screen reader. */
export function describeTaskStage(state: TaskStageState): string {
  if (state.cancelled) return translateUi('Cancelled');
  if (state.exception) return taskStageExceptionLabel(state.exception);
  return taskStageLabel(state.stage);
}

/**
 * Where one run attempt got to. A finished run whose result was not adopted
 * stopped at review and failed there: retrying is what is left to do.
 */
export function getRunStage(run: { status: AgentRunStatus; is_adopted: boolean }): TaskStageState {
  switch (run.status) {
    case 'cancelled':
      return { stage: 'run', exception: null, cancelled: true };
    case 'completed':
      return run.is_adopted
        ? { stage: 'done', exception: null, cancelled: false }
        : { stage: 'review', exception: 'failed', cancelled: false };
    default:
      return getTaskStage({ runStatus: run.status });
  }
}

const AGENT_NAMES: Record<string, string> = {
  claude_code: 'Claude',
  codex: 'Codex',
  codex_cli: 'Codex',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
  paseo: 'Paseo',
};

/** The agent behind a run, by the name people know it by. */
export function agentName(provider: string | null | undefined): string {
  if (!provider) return translateUi('Agent');
  return AGENT_NAMES[provider] ?? provider;
}
