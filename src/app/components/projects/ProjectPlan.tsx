import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  resolveExecutionSkillId,
  useSkillsQuery,
  useStartReadyTaskExecution,
  useTaskGraphInsightsQuery,
  useTaskRelationshipsQuery,
} from '../../hooks/queries';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';
import { useToastStore } from '../../stores/useToastStore';
import type { ProjectOverviewResponse, TaskGraphInsightNode, TodoResponse } from '../../types/api';
import { translateUi } from '../../i18n';
import { ChevronRightIcon, SparkleIcon } from '../shared/Icons';
import EmptyState from '../shared/EmptyState';
import SegmentedControl from '../shared/SegmentedControl';
import TaskGraph from '../task-graph/TaskGraph';
import TaskGraphProposalDialog from '../task-graph/TaskGraphProposalDialog';

type PlanView = 'outline' | 'flow';

interface ProjectPlanProps {
  project: ProjectOverviewResponse;
  todos: TodoResponse[];
  onDiscussTask: (task: TodoResponse, breadcrumb: string) => Promise<void>;
}

function statusLabel(status: TodoResponse['status']): string {
  if (status === 'in_progress') return translateUi('In progress');
  if (status === 'completed') return translateUi('Done');
  if (status === 'cancelled') return translateUi('Cancelled');
  return translateUi('Todo');
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
  const addToast = useToastStore((state) => state.addToast);
  const [view, setView] = useState<PlanView>('outline');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [proposalTarget, setProposalTarget] = useState<TodoResponse | null>(null);
  const { data: relationships = [] } = useTaskRelationshipsQuery();
  const insightsQuery = useTaskGraphInsightsQuery(
    project.root_task_id,
    Boolean(project.root_task_id),
  );
  const selectedTask = todos.find((todo) => todo.id === selectedTaskId) ?? null;
  const selectedInsight = insightsQuery.data?.nodes.find((node) => node.task_id === selectedTaskId);
  const { data: skillsData } = useSkillsQuery(Boolean(selectedInsight?.is_ready));
  const startExecution = useStartReadyTaskExecution();
  const todoById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const insightById = useMemo(
    () => new Map((insightsQuery.data?.nodes ?? []).map((node) => [node.task_id, node])),
    [insightsQuery.data?.nodes],
  );
  const readyTasks = useMemo(
    () =>
      todos.filter((todo) => {
        const insight = insightById.get(todo.id);
        return insight?.is_ready && !insight.is_container;
      }),
    [insightById, todos],
  );
  const runSelectedTask = async () => {
    if (!selectedTask || !selectedInsight?.is_ready) return;
    const skillId = resolveExecutionSkillId(selectedTask, skillsData?.skills ?? []);
    if (!skillId) {
      addToast('warning', translateUi('No execution skill is available for this task.'));
      return;
    }
    if (
      !window.confirm(
        translateUi('Run “{{title}}” with the project defaults?', { title: selectedTask.title }),
      )
    ) {
      return;
    }
    try {
      await startExecution.mutateAsync({
        todoId: selectedTask.id,
        skillId,
        executionProvider: project.default_execution_provider || 'builtin',
        model: project.default_execution_model,
      });
    } catch {
      // The mutation presents the server's actionable error in a toast.
    }
  };
  const selectedBreadcrumb = selectedTask
    ? taskBreadcrumb(selectedTask, todoById, project.root_task_id)
    : '';

  return (
    <>
      <section className="cc-project-ready" aria-label={translateUi('Ready now')}>
        <div className="cc-project-workspace__section-header">
          <div>
            <h2>{translateUi('Ready now')}</h2>
            <p>{translateUi('Tasks that can start without waiting on another task.')}</p>
          </div>
          <strong>{readyTasks.length}</strong>
        </div>
        {readyTasks.length > 0 ? (
          <div className="cc-project-ready__list">
            {readyTasks.slice(0, 5).map((task) => (
              <button
                type="button"
                key={task.id}
                className="cc-project-ready__item"
                onClick={() => setSelectedTaskId(task.id)}
              >
                <span>{task.title}</span>
                <span>{translateUi('Ready')}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="cc-project-ready__empty">{translateUi('No tasks are ready right now.')}</p>
        )}
      </section>

      <section className="cc-project-workspace__section cc-project-plan">
        <div className="cc-project-workspace__section-header">
          <div>
            <h2>{translateUi('Plan')}</h2>
            <p>
              {project.completed_task_count}
              {translateUi(' of ')}
              {project.task_count}
              {translateUi(' tasks completed')}
            </p>
          </div>
          <div className="cc-project-plan__view-actions">
            <button
              type="button"
              className="cc-btn cc-btn--ghost"
              onClick={() => navigate(`/tasks?view=graph&project_id=${project.id}`)}
            >
              {translateUi('Open graph')}
            </button>
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
              message={translateUi('No execution tasks yet. Add a first step to this project.')}
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
                {translateUi('Add first step')}
              </button>
            )}
          </div>
        ) : view === 'outline' ? (
          <ProjectOutline
            todos={todos}
            rootTaskId={project.root_task_id}
            insightById={insightById}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
        ) : (
          <TaskGraph
            todos={todos}
            metadataTodos={todos}
            relationships={relationships}
            fixedProjectId={project.id}
            showPlanningAction={false}
            initialMode="execution"
          />
        )}

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
                className="cc-btn"
                onClick={() =>
                  useQuickCaptureStore.getState().open({ defaultParentId: selectedTask.id })
                }
              >
                {translateUi('+ Step')}
              </button>
              <button
                type="button"
                className="cc-btn"
                onClick={() => setProposalTarget(selectedTask)}
              >
                <SparkleIcon size={14} />
                {translateUi(' Expand')}
              </button>
              <button
                type="button"
                className="cc-btn"
                onClick={() => void onDiscussTask(selectedTask, selectedBreadcrumb)}
              >
                {translateUi('Discuss')}
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                disabled={!selectedInsight?.is_ready || startExecution.isPending}
                title={
                  selectedInsight?.is_ready
                    ? translateUi('Run with the project defaults')
                    : translateUi('This task is not Ready yet')
                }
                onClick={() => void runSelectedTask()}
              >
                {startExecution.isPending ? translateUi('Starting…') : translateUi('Run agent')}
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--ghost"
                onClick={() => navigate(`/tasks/${selectedTask.id}`)}
              >
                {translateUi('Details')}
              </button>
            </div>
          </div>
        )}
      </section>

      {proposalTarget && (
        <TaskGraphProposalDialog
          targets={[proposalTarget]}
          initialTargetId={proposalTarget.id}
          onOpenChange={(open) => {
            if (!open) setProposalTarget(null);
          }}
        />
      )}
    </>
  );
}

function ProjectOutline({
  todos,
  rootTaskId,
  insightById,
  selectedTaskId,
  onSelectTask,
}: {
  todos: TodoResponse[];
  rootTaskId: string | null | undefined;
  insightById: ReadonlyMap<string, TaskGraphInsightNode>;
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
            <span
              className={`cc-project-task-row__state cc-project-task-row__state--${task.status}`}
            />
            <span className="cc-project-outline__copy">
              <strong>{task.title}</strong>
              <small>{statusLabel(task.status)}</small>
            </span>
            {insight?.is_ready && (
              <span className="cc-project-outline__badge">{translateUi('Ready')}</span>
            )}
            {insight?.is_blocked && (
              <span className="cc-project-outline__badge cc-project-outline__badge--blocked">
                {translateUi('Blocked')}
              </span>
            )}
          </button>
        </div>
        {!collapsed && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return <div className="cc-project-outline">{roots.map((task) => renderNode(task, 0))}</div>;
}
