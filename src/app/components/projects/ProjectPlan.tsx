import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  resolveExecutionSkillId,
  useSkillsQuery,
  useStartReadyTaskExecution,
  useTaskGraphInsightsQuery,
  useTaskExecutionTelemetryQuery,
} from '../../hooks/queries';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';
import type {
  ProjectOverviewResponse,
  TaskExecutionTelemetryResponse,
  TaskGraphInsightNode,
  TodoResponse,
} from '../../types/api';
import { translateUi } from '../../i18n';
import { ChevronRightIcon } from '../shared/Icons';
import EmptyState from '../shared/EmptyState';
import SegmentedControl from '../shared/SegmentedControl';
import TaskStageIndicator from '../shared/TaskStageIndicator';
import { describeTaskState } from '../task-list/TaskListView';
import useOpenRunThread from '../../hooks/useOpenRunThread';
import { useOptionalChatPanelController } from '../chat-panel/ChatPanelControllerContext';
import { getChatWorkspaceScope, useChatStore } from '../../stores/useChatStore';
import { projectTaskAction } from './projectTaskAction';

// React Flow is only needed for the flow view and the expand dialog, not the outline.
import TaskFlow from '../task-flow/TaskFlow';
const TaskGraphProposalDialog = lazy(() => import('../task-graph/TaskGraphProposalDialog'));

type PlanView = 'outline' | 'flow';

interface ProjectPlanProps {
  project: ProjectOverviewResponse;
  todos: TodoResponse[];
  onDiscussTask: (task: TodoResponse, breadcrumb: string) => Promise<void>;
}

function taskBreadcrumb(
  task: TodoResponse,
  todoById: ReadonlyMap<string, TodoResponse>,
  rootTaskId: string | null | undefined,
): string {
  const labels = [task.title];
  const visited = new Set([task.id]);
  let parentId = task.parent_id;
  while (parentId && parentId !== rootTaskId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = todoById.get(parentId);
    if (!parent) break;
    labels.unshift(parent.title);
    parentId = parent.parent_id;
  }
  return labels.join(' › ');
}

export default function ProjectPlan({ project, todos, onDiscussTask }: ProjectPlanProps) {
  const navigate = useNavigate();
  const openRunThread = useOpenRunThread();
  const panel = useOptionalChatPanelController();
  const selectionKey = JSON.stringify([getChatWorkspaceScope(), project.id]);
  const selection = useChatStore((state) => state.projectPlanSelections[selectionKey]);
  const view = selection?.view === 'flow' ? 'flow' : 'outline';
  const selectedTaskId = todos.some((todo) => todo.id === selection?.taskId)
    ? selection!.taskId
    : null;
  const setView = (nextView: PlanView) =>
    useChatStore
      .getState()
      .setProjectPlanSelection(project.id, { view: nextView, taskId: selectedTaskId });
  const setSelectedTaskId = (taskId: string | null) =>
    useChatStore.getState().setProjectPlanSelection(project.id, { view, taskId });
  const [proposalTarget, setProposalTarget] = useState<TodoResponse | null>(null);
  // Whole-graph insights, not the root's subtree: a task can belong to the
  // project without hanging under its root, and readiness depends on blockers
  // anywhere. The plan filters to its own tasks through `todos`.
  const insightsQuery = useTaskGraphInsightsQuery(null);
  const selectedTask = todos.find((todo) => todo.id === selectedTaskId) ?? null;
  const selectedInsight = insightsQuery.data?.nodes.find((node) => node.task_id === selectedTaskId);
  const telemetryQuery = useTaskExecutionTelemetryQuery(project.id);
  const selectedTelemetry = telemetryQuery.data?.find((item) => item.task_id === selectedTaskId);
  const primaryAction = selectedTask
    ? projectTaskAction(selectedTask, selectedInsight, selectedTelemetry, telemetryQuery.isSuccess)
    : null;
  const { data: skillsData } = useSkillsQuery(Boolean(selectedInsight?.is_ready));
  const startExecution = useStartReadyTaskExecution();
  const todoById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const insightById = useMemo(
    () => new Map((insightsQuery.data?.nodes ?? []).map((node) => [node.task_id, node])),
    [insightsQuery.data?.nodes],
  );
  const telemetryByTaskId = useMemo(
    () => new Map((telemetryQuery.data ?? []).map((item) => [item.task_id, item])),
    [telemetryQuery.data],
  );
  const runSelectedTask = async () => {
    if (!selectedTask || primaryAction?.kind !== 'run') return;
    const skillId = resolveExecutionSkillId(selectedTask, skillsData?.skills ?? []);
    if (
      !window.confirm(
        translateUi('Run “{{title}}” with the project defaults?', { title: selectedTask.title }),
      )
    ) {
      return;
    }
    const isCurrentSelection = panel?.beginSelection?.() ?? (() => true);
    try {
      const result = await startExecution.mutateAsync({
        todoId: selectedTask.id,
        skillId,
        executionProvider: project.default_execution_provider || 'builtin',
        model: project.default_execution_model,
      });
      if (isCurrentSelection()) {
        await openRunThread(result.run_id, `${project.title} › ${selectedTask.title}`);
      }
    } catch {
      // The mutation presents the server's actionable error in a toast.
    }
  };
  const selectedBreadcrumb = selectedTask
    ? taskBreadcrumb(selectedTask, todoById, project.root_task_id)
    : '';

  return (
    <>
      <section
        className="cc-project-workspace__section cc-project-plan"
        aria-label={translateUi('Plan')}
      >
        <div className="cc-project-workspace__section-header">
          <div>
            <h2>{translateUi('Plan')}</h2>
            <p>
              {translateUi('{{done}}/{{total}} done', {
                done: project.completed_task_count,
                total: project.task_count,
              })}
            </p>
          </div>
          <div className="cc-project-plan__view-actions">
            <SegmentedControl
              ariaLabel={translateUi('Project plan view')}
              options={[
                { label: translateUi('Outline'), value: 'outline' },
                { label: translateUi('Flow'), value: 'flow' },
              ]}
              value={view}
              onChange={(value) => setView(value as PlanView)}
            />
          </div>
        </div>

        {todos.length === 0 ? (
          <div className="cc-project-plan__empty">
            <EmptyState
              icon={<span>✓</span>}
              message={translateUi('No tasks yet. Add the first task to this project.')}
            />
            {project.root_task_id && (
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                onClick={() =>
                  useQuickCaptureStore
                    .getState()
                    .open({ defaultParentId: project.root_task_id ?? undefined })
                }
              >
                {translateUi('Add the first task')}
              </button>
            )}
          </div>
        ) : view === 'outline' ? (
          <ProjectOutline
            todos={todos}
            rootTaskId={project.root_task_id}
            insightById={insightById}
            telemetryByTaskId={telemetryByTaskId}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
        ) : project.root_task_id ? (
          <TaskFlow
            rootId={project.root_task_id}
            selectedId={selectedTaskId}
            onSelect={setSelectedTaskId}
          />
        ) : null}

        {selectedTask && (
          <div
            className="cc-project-task-actions"
            aria-label={translateUi('Selected task actions')}
          >
            <div>
              <small>{translateUi('Selected task')}</small>
              <strong>{selectedBreadcrumb}</strong>
            </div>
            <div className="cc-project-task-actions__buttons">
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                disabled={startExecution.isPending}
                onClick={() => {
                  if (primaryAction?.kind === 'run') void runSelectedTask();
                  else if (primaryAction?.kind === 'thread' && primaryAction.runId) {
                    void openRunThread(
                      primaryAction.runId,
                      `${project.title} › ${selectedTask.title}`,
                    );
                  } else navigate(`/tasks/${selectedTask.id}`);
                }}
              >
                {startExecution.isPending
                  ? translateUi('Starting…')
                  : translateUi(primaryAction?.label ?? 'Details')}
              </button>
              <details key={selectedTask.id}>
                <summary className="cc-btn cc-btn--ghost">{translateUi('Actions')}</summary>
                <div className="cc-project-task-actions__buttons">
                  <button
                    type="button"
                    className="cc-btn"
                    onClick={() =>
                      useQuickCaptureStore.getState().open({ defaultParentId: selectedTask.id })
                    }
                  >
                    {translateUi('+ Task')}
                  </button>
                  <button
                    type="button"
                    className="cc-btn"
                    onClick={() => setProposalTarget(selectedTask)}
                  >
                    {translateUi('Expand')}
                  </button>
                  <button
                    type="button"
                    className="cc-btn"
                    onClick={() => void onDiscussTask(selectedTask, selectedBreadcrumb)}
                  >
                    {translateUi('Discuss')}
                  </button>
                  {primaryAction?.kind !== 'details' && (
                    <button
                      type="button"
                      className="cc-btn cc-btn--ghost"
                      onClick={() => navigate(`/tasks/${selectedTask.id}`)}
                    >
                      {translateUi('Details')}
                    </button>
                  )}
                </div>
              </details>
            </div>
          </div>
        )}
      </section>

      {proposalTarget && (
        <Suspense fallback={null}>
          <TaskGraphProposalDialog
            targets={[proposalTarget]}
            initialTargetId={proposalTarget.id}
            onOpenChange={(open) => {
              if (!open) setProposalTarget(null);
            }}
          />
        </Suspense>
      )}
    </>
  );
}

function ProjectOutline({
  todos,
  rootTaskId,
  insightById,
  telemetryByTaskId,
  selectedTaskId,
  onSelectTask,
}: {
  todos: TodoResponse[];
  rootTaskId: string | null | undefined;
  insightById: ReadonlyMap<string, TaskGraphInsightNode>;
  telemetryByTaskId: ReadonlyMap<string, TaskExecutionTelemetryResponse>;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const todoIds = useMemo(() => new Set(todos.map((todo) => todo.id)), [todos]);
  const childrenByParent = useMemo(() => {
    const children = new Map<string | null, TodoResponse[]>();
    for (const todo of todos) {
      const parent = todo.parent_id && todoIds.has(todo.parent_id) ? todo.parent_id : null;
      children.set(parent, [...(children.get(parent) ?? []), todo]);
    }
    for (const siblings of children.values()) {
      siblings.sort(
        (left, right) =>
          (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.title.localeCompare(right.title),
      );
    }
    return children;
  }, [todoIds, todos]);
  const roots = useMemo(() => {
    const directRoots = rootTaskId
      ? todos.filter((todo) => todo.parent_id === rootTaskId)
      : (childrenByParent.get(null) ?? []);
    const detachedRoots = (childrenByParent.get(null) ?? []).filter(
      (todo) => !directRoots.some((root) => root.id === todo.id),
    );
    return [...directRoots, ...detachedRoots];
  }, [childrenByParent, rootTaskId, todos]);
  const renderNode = (task: TodoResponse, depth: number): React.ReactNode => {
    const children = childrenByParent.get(task.id) ?? [];
    const collapsed = collapsedIds.has(task.id);
    const insight = insightById.get(task.id);
    const { state, label } = describeTaskState(
      task,
      Boolean(insight?.is_blocked),
      telemetryByTaskId.get(task.id),
    );
    // A task nothing waits on reads "Ready", in the same grey as every other step.
    const stageLabel =
      insight?.is_ready && state.stage === 'capture' && !state.exception
        ? translateUi('Ready')
        : label;
    return (
      <div key={task.id} className="cc-project-outline__branch">
        <div
          className={`cc-project-outline__row${selectedTaskId === task.id ? ' cc-project-outline__row--selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 20 }}
        >
          {children.length > 0 ? (
            <button
              type="button"
              className="cc-project-outline__toggle"
              aria-label={translateUi(collapsed ? 'Show sub-tasks' : 'Hide sub-tasks')}
              aria-expanded={!collapsed}
              onClick={() =>
                setCollapsedIds((current) => {
                  const next = new Set(current);
                  if (next.has(task.id)) next.delete(task.id);
                  else next.add(task.id);
                  return next;
                })
              }
            >
              <ChevronRightIcon
                size={14}
                style={{ transform: collapsed ? undefined : 'rotate(90deg)' }}
              />
            </button>
          ) : (
            <span className="cc-project-outline__toggle" aria-hidden="true" />
          )}
          <button
            type="button"
            className="cc-project-outline__task"
            onClick={() => onSelectTask(task.id)}
          >
            <span className="cc-project-outline__copy">
              <strong>{task.title}</strong>
            </span>
            <TaskStageIndicator state={state} label={stageLabel} />
          </button>
        </div>
        {!collapsed && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return <div className="cc-project-outline">{roots.map((task) => renderNode(task, 0))}</div>;
}
