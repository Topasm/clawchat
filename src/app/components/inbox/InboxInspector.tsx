import type { ReactNode } from 'react';
import type {
  ExecutionProviderStatus,
  ProjectResponse,
  Skill,
  TaskExecutionTelemetryResponse,
  TaskGraphInsightNode,
  TaskGraphInsightsResponse,
  TodoResponse,
} from '../../types/api';
import InboxDependencyPreviewPanel from './InboxDependencyPreviewPanel';
import InboxExecutionTelemetryPanel from './InboxExecutionTelemetryPanel';
import ReadyTaskExecutionPanel, { type ReadyTaskExecutionRequest } from './ReadyTaskExecutionPanel';
import type { InboxDependencyPreview } from '../../hooks/useInboxDependencyPreview';
import { Pane } from '../shared/WorkspacePrimitives';
import { translateUi } from '../../i18n';
interface InboxInspectorProps {
  task: TodoResponse | null;
  projects: ProjectResponse[];
  todoById: ReadonlyMap<string, TodoResponse>;
  insight?: TaskGraphInsightNode;
  telemetry?: TaskExecutionTelemetryResponse;
  summary?: TaskGraphInsightsResponse['summary'];
  project?: ProjectResponse;
  skills: Skill[];
  providers: ExecutionProviderStatus[];
  isStartingExecution: boolean;
  dependency: InboxDependencyPreview;
  dependencyCandidates: TodoResponse[];
  graphRevisionReady: boolean;
  isPlacing: boolean;
  /** Rendered inside the mobile disclosure; omitted on desktop, where the tree is a column. */
  mobileTree?: ReactNode;
  onStartExecution: (
    taskId: string,
    request: ReadyTaskExecutionRequest,
  ) => Promise<{
    run_id: string;
  }>;
  onReturnToInbox: (taskId: string) => void;
  onNavigate: (path: string) => void;
  /** Opens (or starts) the thread scoped to this task, where the agent works with you on it. */
  onOpenConversation?: (taskId: string) => void;
}
/** The right-hand panel: everything the triage user can learn or do about one task. */
export default function InboxInspector({
  task,
  projects,
  todoById,
  insight,
  telemetry,
  summary,
  project,
  skills,
  providers,
  isStartingExecution,
  dependency,
  dependencyCandidates,
  graphRevisionReady,
  isPlacing,
  mobileTree,
  onStartExecution,
  onReturnToInbox,
  onNavigate,
  onOpenConversation,
}: InboxInspectorProps) {
  return (
    <Pane
      as="aside"
      className="cc-inbox-triage__inspector"
      aria-label={translateUi('Selected task')}
    >
      {task ? (
        <>
          <span>{translateUi('Selected task')}</span>
          <h2>{task.title}</h2>
          <dl>
            <div>
              <dt>{translateUi('Project')}</dt>
              <dd>
                {projects.find((item) => item.id === task.project_id)?.title ??
                  translateUi('Inbox')}
              </dd>
            </div>
            <div>
              <dt>{translateUi('Status')}</dt>
              <dd>{task.status.replace('_', ' ')}</dd>
            </div>
            {insight && (
              <div>
                <dt>{translateUi('Execution')}</dt>
                <dd>{insight.execution_state.replace('_', ' ')}</dd>
              </div>
            )}
          </dl>
          {summary && (
            <p className="cc-inbox-triage__impact">
              {translateUi('\n              Ready ')}
              {summary.ready_count}
              {translateUi(' \u00B7 Blocked ')}
              {summary.blocked_count}
              {translateUi(' \u00B7 Critical path')}{' '}
              {summary.critical_path_minutes == null
                ? translateUi('unknown')
                : `${summary.critical_path_minutes}m`}
            </p>
          )}
          {telemetry && (
            <InboxExecutionTelemetryPanel
              telemetry={telemetry}
              projectId={task.project_id}
              onNavigate={onNavigate}
            />
          )}
          {insight && (
            <ReadyTaskExecutionPanel
              task={task}
              insight={insight}
              telemetry={telemetry}
              project={project}
              skills={skills}
              providers={providers}
              isStarting={isStartingExecution}
              onStart={(request) => onStartExecution(task.id, request)}
              onOpenRun={(runId) => onNavigate(`/runs?run_id=${runId}`)}
            />
          )}
          <div className="cc-inbox-triage__dependency-picker">
            <label htmlFor="inbox-prerequisite-select">{translateUi('Must wait for')}</label>
            <select
              id="inbox-prerequisite-select"
              value=""
              disabled={!graphRevisionReady || dependency.isPreviewing || dependency.isCreating}
              onChange={(event) => {
                const prerequisiteTaskId = event.target.value;
                if (prerequisiteTaskId) {
                  void dependency.requestPreview(task.id, prerequisiteTaskId);
                }
              }}
            >
              <option value="">{translateUi('Choose a prerequisite\u2026')}</option>
              {dependencyCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
            <small>
              {translateUi('Desktop: drag \u219D from the dependent task onto its prerequisite.')}
            </small>
          </div>
          {dependency.preview && (
            <InboxDependencyPreviewPanel
              preview={dependency.preview}
              todoById={todoById}
              isCreating={dependency.isCreating}
              onConfirm={() => void dependency.confirmPreview()}
              onCancel={dependency.dismissPreview}
            />
          )}
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => onNavigate(`/tasks/${task.id}`)}
          >
            {translateUi('\n            Open details\n          ')}
          </button>
          {onOpenConversation && (
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={() => onOpenConversation(task.id)}
            >
              {translateUi('Discuss with agent')}
            </button>
          )}
          {task.project_id && (
            <button
              type="button"
              className="cc-btn cc-btn--ghost"
              disabled={isPlacing}
              onClick={() => onReturnToInbox(task.id)}
            >
              {translateUi('\n              Return to Inbox\n            ')}
            </button>
          )}
          {mobileTree && (
            <details className="cc-inbox-triage__mobile-tree">
              <summary>{translateUi('Move to project tree')}</summary>
              {mobileTree}
            </details>
          )}
        </>
      ) : (
        <p>{translateUi('Select or drag an Inbox card to organize it.')}</p>
      )}
    </Pane>
  );
}
