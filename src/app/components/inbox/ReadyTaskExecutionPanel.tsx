import { useEffect, useState } from 'react';
import type {
  ExecutionProviderStatus,
  ProjectResponse,
  TaskExecutionTelemetryResponse,
  TaskGraphInsightNode,
  TodoResponse,
} from '../../types/api';
import { translateUi } from '../../i18n';
import { skillChainLabel, skillLabel } from '../../utils/skillLabels';
const ACTIVE_AGENT_RUN_STATUSES = new Set([
  'queued',
  'starting',
  'running',
  'waiting_input',
  'waiting_review',
]);
export interface ReadyTaskExecutionRequest {
  /** Only when the task was explicitly assigned one; otherwise the server picks. */
  skillId: string | null;
  executionProvider: string;
  model?: string | null;
}
export interface ReadyTaskExecutionResult {
  run_id: string;
  skill_chain?: string[];
  skill_source?: 'requested' | 'assigned' | 'auto';
}
interface ReadyTaskExecutionPanelProps {
  task: TodoResponse;
  insight: TaskGraphInsightNode;
  telemetry?: TaskExecutionTelemetryResponse;
  project?: ProjectResponse;
  providers: ExecutionProviderStatus[];
  isStarting: boolean;
  onStart: (request: ReadyTaskExecutionRequest) => Promise<ReadyTaskExecutionResult>;
  onOpenRun: (runId: string) => void;
}
export default function ReadyTaskExecutionPanel({
  task,
  insight,
  telemetry,
  project,
  providers,
  isStarting,
  onStart,
  onOpenRun,
}: ReadyTaskExecutionPanelProps) {
  // An explicitly assigned skill is honoured; otherwise the server reads the
  // task and chooses, so there is nothing here for the user to know.
  const assignedSkill = task.enabled_skills?.find((skillId) => skillId !== 'plan') ?? null;
  const [providerId, setProviderId] = useState('');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [started, setStarted] = useState<ReadyTaskExecutionResult | null>(null);
  useEffect(() => {
    setProviderId('');
    setConfirmationOpen(false);
    setStarted(null);
  }, [task.id]);
  const selectedProviderId = providerId || project?.default_execution_provider || 'builtin';
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  // Providers ClawChat bridges to run in the project's own workspace.
  const needsWorkspace = selectedProviderId === 'paseo' || selectedProviderId === 'opencode';
  const workspaceReady = !needsWorkspace || Boolean(project?.execution_workspace_path);
  const providerReady = Boolean(
    selectedProvider?.enabled &&
    selectedProvider.available &&
    selectedProvider.connected &&
    workspaceReady,
  );
  const hasActiveRun = Boolean(
    telemetry?.latest_run_status && ACTIVE_AGENT_RUN_STATUSES.has(telemetry.latest_run_status),
  );
  if (insight.is_container || hasActiveRun) return null;
  return (
    <>
      <section
        className="cc-inbox-triage__agent-execution"
        aria-label={translateUi('Start agent execution')}
      >
        <div className="cc-inbox-triage__agent-heading">
          <div>
            <strong>{translateUi('Run with agent')}</strong>
            <small>
              {insight.is_ready
                ? translateUi('Ready \u00B7 one run starts only after confirmation')
                : translateUi('Unavailable while {{state}}', {
                    state: insight.execution_state.replace('_', ' '),
                  })}
            </small>
          </div>
          <span data-ready={insight.is_ready}>
            {insight.is_ready ? translateUi('Ready') : translateUi('Locked')}
          </span>
        </div>
        {insight.is_ready && (
          <>
            <p className="cc-inbox-triage__agent-skill">
              {assignedSkill
                ? translateUi('Skill: {{skill}} (assigned)', { skill: skillLabel(assignedSkill) })
                : translateUi('Skill: chosen from the task when the run starts')}
            </p>
            <label>
              {translateUi('\n              Provider\n              ')}
              <select
                value={selectedProviderId}
                disabled={isStarting}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setConfirmationOpen(false);
                }}
              >
                {providers.map((provider) => (
                  <option
                    key={provider.id}
                    value={provider.id}
                    disabled={!provider.enabled || !provider.available || !provider.connected}
                  >
                    {provider.label}
                    {!provider.connected ? translateUi(' (unavailable)') : ''}
                  </option>
                ))}
              </select>
            </label>
            {needsWorkspace && !workspaceReady && (
              <p>
                {translateUi(
                  'Configure this Project\u2019s execution workspace before using {{provider}}.',
                  { provider: selectedProvider?.label ?? selectedProviderId },
                )}
              </p>
            )}
            {!confirmationOpen ? (
              <button
                type="button"
                className="cc-btn cc-btn--secondary"
                disabled={!providerReady || isStarting}
                onClick={() => setConfirmationOpen(true)}
              >
                {translateUi('\n                Review agent run\n              ')}
              </button>
            ) : (
              <div className="cc-inbox-triage__agent-confirm" aria-live="polite">
                <strong>{translateUi('Start one approved run?')}</strong>
                <p>
                  “{task.title}
                  {translateUi(
                    '\u201D moves to In Progress. The result will wait for review before\n                  completion.\n                ',
                  )}
                </p>
                <div>
                  <button
                    type="button"
                    className="cc-btn cc-btn--primary"
                    disabled={isStarting}
                    onClick={async () => {
                      try {
                        const result = await onStart({
                          skillId: assignedSkill,
                          executionProvider: selectedProviderId,
                          model:
                            selectedProviderId === project?.default_execution_provider
                              ? project.default_execution_model
                              : null,
                        });
                        setStarted(result);
                        setConfirmationOpen(false);
                      } catch {
                        // The owning mutation translates the server error for the user.
                      }
                    }}
                  >
                    {isStarting ? translateUi('Starting\u2026') : translateUi('Start agent run')}
                  </button>
                  <button
                    type="button"
                    className="cc-btn cc-btn--ghost"
                    disabled={isStarting}
                    onClick={() => setConfirmationOpen(false)}
                  >
                    {translateUi('\n                    Cancel\n                  ')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {started && (
        <>
          {started.skill_chain && started.skill_chain.length > 0 && (
            <p className="cc-inbox-triage__agent-skill">
              {started.skill_source === 'auto'
                ? translateUi('Skill chosen for this run: {{skills}}', {
                    skills: skillChainLabel(started.skill_chain),
                  })
                : translateUi('Skill: {{skills}}', {
                    skills: skillChainLabel(started.skill_chain),
                  })}
            </p>
          )}
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => onOpenRun(started.run_id)}
          >
            {translateUi('Open started run')}
          </button>
        </>
      )}
    </>
  );
}
