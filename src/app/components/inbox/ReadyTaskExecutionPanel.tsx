import { useEffect, useMemo, useState } from 'react';
import type {
  ExecutionProviderStatus,
  ProjectResponse,
  Skill,
  TaskExecutionTelemetryResponse,
  TaskGraphInsightNode,
  TodoResponse,
} from '../../types/api';
import { translateUi } from '../../i18n';
const ACTIVE_AGENT_RUN_STATUSES = new Set([
  'queued',
  'starting',
  'running',
  'waiting_input',
  'waiting_review',
]);
export interface ReadyTaskExecutionRequest {
  skillId: string;
  executionProvider: string;
  model?: string | null;
}
interface ReadyTaskExecutionPanelProps {
  task: TodoResponse;
  insight: TaskGraphInsightNode;
  telemetry?: TaskExecutionTelemetryResponse;
  project?: ProjectResponse;
  skills: Skill[];
  providers: ExecutionProviderStatus[];
  isStarting: boolean;
  onStart: (request: ReadyTaskExecutionRequest) => Promise<{
    run_id: string;
  }>;
  onOpenRun: (runId: string) => void;
}
export default function ReadyTaskExecutionPanel({
  task,
  insight,
  telemetry,
  project,
  skills,
  providers,
  isStarting,
  onStart,
  onOpenRun,
}: ReadyTaskExecutionPanelProps) {
  const executableSkills = useMemo(() => skills.filter((skill) => skill.id !== 'plan'), [skills]);
  const assignedSkill = task.enabled_skills?.find((skillId) =>
    executableSkills.some((skill) => skill.id === skillId),
  );
  const [skillId, setSkillId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  useEffect(() => {
    setSkillId('');
    setProviderId('');
    setConfirmationOpen(false);
    setStartedRunId(null);
  }, [task.id]);
  const selectedSkillId = skillId || assignedSkill || executableSkills[0]?.id || '';
  const selectedProviderId = providerId || project?.default_execution_provider || 'builtin';
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const paseoWorkspaceReady =
    selectedProviderId !== 'paseo' || Boolean(project?.execution_workspace_path);
  const providerReady = Boolean(
    selectedProvider?.enabled &&
    selectedProvider.available &&
    selectedProvider.connected &&
    paseoWorkspaceReady,
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
            <label>
              {translateUi('\n              Skill\n              ')}
              <select
                value={selectedSkillId}
                disabled={isStarting}
                onChange={(event) => {
                  setSkillId(event.target.value);
                  setConfirmationOpen(false);
                }}
              >
                {executableSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
            </label>
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
            {selectedProviderId === 'paseo' && !paseoWorkspaceReady && (
              <p>
                {translateUi(
                  'Configure this Project\u2019s execution workspace before using Paseo.',
                )}
              </p>
            )}
            {!confirmationOpen ? (
              <button
                type="button"
                className="cc-btn cc-btn--secondary"
                disabled={!selectedSkillId || !providerReady || isStarting}
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
                          skillId: selectedSkillId,
                          executionProvider: selectedProviderId,
                          model:
                            selectedProviderId === project?.default_execution_provider
                              ? project.default_execution_model
                              : null,
                        });
                        setStartedRunId(result.run_id);
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
      {startedRunId && (
        <button
          type="button"
          className="cc-btn cc-btn--secondary"
          onClick={() => onOpenRun(startedRunId)}
        >
          {translateUi('\n          Open started run\n        ')}
        </button>
      )}
    </>
  );
}
