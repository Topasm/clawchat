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
  ) => Promise<{ run_id: string }>;
  onReturnToInbox: (taskId: string) => void;
  onNavigate: (path: string) => void;
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
}: InboxInspectorProps) {
  return (
    <Pane as="aside" className="cc-inbox-triage__inspector" aria-label="Selected task">
      {task ? (
        <>
          <span>Selected task</span>
          <h2>{task.title}</h2>
          <dl>
            <div>
              <dt>Project</dt>
              <dd>{projects.find((item) => item.id === task.project_id)?.title ?? 'Inbox'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{task.status.replace('_', ' ')}</dd>
            </div>
            {insight && (
              <div>
                <dt>Execution</dt>
                <dd>{insight.execution_state.replace('_', ' ')}</dd>
              </div>
            )}
          </dl>
          {summary && (
            <p className="cc-inbox-triage__impact">
              Ready {summary.ready_count} · Blocked {summary.blocked_count} · Critical path{' '}
              {summary.critical_path_minutes == null
                ? 'unknown'
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
            <label htmlFor="inbox-prerequisite-select">Must wait for</label>
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
              <option value="">Choose a prerequisite…</option>
              {dependencyCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
            <small>Desktop: drag ↝ from the dependent task onto its prerequisite.</small>
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
            Open details
          </button>
          {task.project_id && (
            <button
              type="button"
              className="cc-btn cc-btn--ghost"
              disabled={isPlacing}
              onClick={() => onReturnToInbox(task.id)}
            >
              Return to Inbox
            </button>
          )}
          {mobileTree && (
            <details className="cc-inbox-triage__mobile-tree">
              <summary>Move to project tree</summary>
              {mobileTree}
            </details>
          )}
        </>
      ) : (
        <p>Select or drag an Inbox card to organize it.</p>
      )}
    </Pane>
  );
}
