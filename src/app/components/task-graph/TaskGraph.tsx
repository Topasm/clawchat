import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TodoResponse } from '../../types/api';
import usePlatform from '../../hooks/usePlatform';
import { useProjectsQuery, useTaskGraphInsightsQuery, useUpdateTodo } from '../../hooks/queries';
import useInboxDependencyPreview from '../../hooks/useInboxDependencyPreview';
import useInboxGraphRevision from '../../hooks/useInboxGraphRevision';
import { useToastStore } from '../../stores/useToastStore';
import InboxDependencyPreviewPanel from '../inbox/InboxDependencyPreviewPanel';
import { useAuthStore } from '../../stores/useAuthStore';
import SegmentedControl from '../shared/SegmentedControl';
import { SparkleIcon } from '../shared/Icons';
import {
  augmentTaskGraphTodos,
  buildTaskGraphElements,
  collectDefaultCollapsedTaskIds,
  collectTaskSubtreeIds,
  expandTaskGraphContext,
  mergeExecutionRelationships,
} from './taskGraphAdapter';
import type { GraphRelationshipLike } from './taskGraphLayout';
import TaskGraphView from './TaskGraphView';
import TaskGraphProposalDialog from './TaskGraphProposalDialog';
import { TaskGraphHealthPanel, TaskGraphNodeInsightPanel } from './TaskGraphInsightsPanel';
import type { TaskGraphMode } from './taskGraphTypes';
import { resolveGraphConnection } from './taskGraphConnect';
import {
  createTaskGraphLayoutScope,
  loadTaskGraphLayout,
  resetTaskGraphLayout,
  updateTaskGraphLayout,
} from './taskGraphPersistence';
import { translateUi } from '../../i18n';
import { matchesTasksStatusFilter, type TasksStatusFilter } from '../tasks/TasksHeader';
interface TaskGraphProps {
  todos: TodoResponse[];
  metadataTodos?: TodoResponse[];
  relationships?: GraphRelationshipLike[];
  hasExternalFilter?: boolean;
  fixedProjectId?: string;
  showPlanningAction?: boolean;
  showStatusControls?: boolean;
  /** Without the status controls, whether finished tasks stay off the canvas. */
  hideCompleted?: boolean;
  initialMode?: TaskGraphMode;
  selectedTaskId?: string | null;
  onSelectTask?: (id: string | null) => void;
}
const GRAPH_MODE_OPTIONS = [
  { label: 'Structure', value: 'structure' },
  { label: 'Execution', value: 'execution' },
];
export default function TaskGraph({
  todos,
  metadataTodos = todos,
  relationships = [],
  hasExternalFilter = false,
  fixedProjectId,
  showPlanningAction = true,
  showStatusControls = true,
  hideCompleted: hideCompletedWithoutControls = true,
  initialMode = 'structure',
  selectedTaskId: controlledTaskId,
  onSelectTask,
}: TaskGraphProps) {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const [mode, setMode] = useState<TaskGraphMode>(initialMode);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [hideCompleted, setHideCompleted] = useState(true);
  const [projectId, setProjectId] = useState(fixedProjectId ?? 'all');
  const [statusFilter, setStatusFilter] = useState<TasksStatusFilter>('all');
  const [proposalOpen, setProposalOpen] = useState(false);
  const [localTaskId, setLocalTaskId] = useState<string | null>(null);
  const selectedTaskId = controlledTaskId === undefined ? localTaskId : controlledTaskId;
  const setSelectedTaskId = useCallback(
    (id: string | null) => {
      if (onSelectTask) onSelectTask(id);
      else setLocalTaskId(id);
    },
    [onSelectTask],
  );
  const [layoutResetVersion, setLayoutResetVersion] = useState(0);
  const [reparent, setReparent] = useState<{ childTaskId: string; parentTaskId: string } | null>(
    null,
  );
  const addToast = useToastStore((state) => state.addToast);
  const updateTodo = useUpdateTodo();
  const projectsQuery = useProjectsQuery();
  const projectOptions = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const selectedProject = useMemo(
    () => projectOptions.find((project) => project.id === projectId),
    [projectId, projectOptions],
  );
  const projectRootTaskId = selectedProject?.root_task_id ?? null;
  const projectRootIds = useMemo(
    () => new Set(projectOptions.flatMap((project) => project.root_task_id ?? [])),
    [projectOptions],
  );
  const insightsQuery = useTaskGraphInsightsQuery(
    projectId === 'all' ? null : projectRootTaskId,
    (projectId === 'all' || projectRootTaskId !== null) &&
      (mode === 'execution' || selectedTaskId !== null),
  );
  const layoutScope = useMemo(() => createTaskGraphLayoutScope(projectId, mode), [mode, projectId]);
  const planningTargets = useMemo(
    () =>
      metadataTodos
        .filter(
          (todo) => !todo.parent_id && todo.status !== 'completed' && todo.status !== 'cancelled',
        )
        .sort((a, b) => a.title.localeCompare(b.title)),
    [metadataTodos],
  );
  useEffect(() => {
    if (fixedProjectId) {
      setProjectId(fixedProjectId);
      return;
    }
    if (
      !projectsQuery.isLoading &&
      projectId !== 'all' &&
      !projectOptions.some((project) => project.id === projectId)
    ) {
      setProjectId('all');
    }
  }, [fixedProjectId, projectId, projectOptions, projectsQuery.isLoading]);
  useEffect(() => {
    const saved = loadTaskGraphLayout(layoutScope);
    if (saved.initialized) {
      setCollapsedIds(new Set(saved.collapsedIds));
      return;
    }
    if (metadataTodos.length === 0 || projectsQuery.isLoading) {
      setCollapsedIds(new Set());
      return;
    }
    const defaults = collectDefaultCollapsedTaskIds(metadataTodos, projectRootTaskId);
    setCollapsedIds(defaults);
    updateTaskGraphLayout(layoutScope, { collapsedIds: [...defaults] });
  }, [layoutScope, metadataTodos, projectRootTaskId, projectsQuery.isLoading]);
  const projectIds = useMemo(() => {
    if (projectId === 'all') return null;
    return projectRootTaskId
      ? collectTaskSubtreeIds(projectRootTaskId, metadataTodos)
      : new Set<string>();
  }, [metadataTodos, projectId, projectRootTaskId]);
  const graphRelationships = useMemo(
    () =>
      mode === 'execution' && insightsQuery.data
        ? mergeExecutionRelationships(relationships, insightsQuery.data.nodes)
        : relationships,
    [insightsQuery.data, mode, relationships],
  );
  const scopedTodos = useMemo(() => {
    const projectTodos = projectIds ? todos.filter((todo) => projectIds.has(todo.id)) : todos;
    if (!insightsQuery.data) return projectTodos;
    return augmentTaskGraphTodos(
      projectTodos,
      metadataTodos,
      insightsQuery.data.nodes,
      insightsQuery.data.generated_at,
      {
        includeAllMissing: mode === 'execution' && !hasExternalFilter,
        includeContextMissing: Boolean(projectIds),
      },
    );
  }, [hasExternalFilter, insightsQuery.data, metadataTodos, mode, projectIds, todos]);
  const graphTodos = useMemo(() => {
    if (statusFilter === 'all') return scopedTodos;
    const matches = scopedTodos.filter((todo) =>
      matchesTasksStatusFilter(todo.status, statusFilter),
    );
    return expandTaskGraphContext(scopedTodos, matches, graphRelationships);
  }, [graphRelationships, scopedTodos, statusFilter]);
  const graphMetadataTodos = useMemo(() => {
    const metadataIds = new Set(metadataTodos.map((todo) => todo.id));
    return [...metadataTodos, ...scopedTodos.filter((todo) => !metadataIds.has(todo.id))];
  }, [metadataTodos, scopedTodos]);
  const todoById = useMemo(
    () => new Map(graphMetadataTodos.map((todo) => [todo.id, todo])),
    [graphMetadataTodos],
  );
  // Drawing an edge on the canvas goes through the same preview-and-confirm
  // step as the Inbox's ↝ drag, against the same graph revision.
  const { placementRevision, setPlacementRevision, refreshPlacementRevision } =
    useInboxGraphRevision(insightsQuery);
  const dependency = useInboxDependencyPreview({
    todoById,
    selectedTaskId,
    selectTask: setSelectedTaskId,
    placementRevision,
    setPlacementRevision,
    refreshPlacementRevision,
  });
  const handleConnect = useCallback(
    (sourceId: string, targetId: string) => {
      const connection = resolveGraphConnection(
        mode,
        sourceId,
        targetId,
        graphMetadataTodos,
        graphRelationships,
      );
      if (connection.kind === 'invalid') {
        const child = todoById.get(targetId)?.title ?? '';
        const parent = todoById.get(sourceId)?.title ?? '';
        addToast(
          'warning',
          connection.reason === 'self'
            ? translateUi('A task cannot wait for itself')
            : connection.reason === 'duplicate'
              ? translateUi('That dependency already exists')
              : connection.reason === 'same-parent'
                ? translateUi('“{{child}}” is already a sub-task of “{{parent}}”', {
                    child,
                    parent,
                  })
                : translateUi('A task cannot become a sub-task of its own sub-task'),
        );
        return;
      }
      if (connection.kind === 'dependency') {
        setReparent(null);
        void dependency.requestPreview(connection.dependentTaskId, connection.prerequisiteTaskId);
        return;
      }
      dependency.dismissPreview();
      setSelectedTaskId(connection.childTaskId);
      setReparent({ childTaskId: connection.childTaskId, parentTaskId: connection.parentTaskId });
    },
    [
      addToast,
      dependency,
      graphMetadataTodos,
      graphRelationships,
      mode,
      setSelectedTaskId,
      todoById,
    ],
  );
  const confirmReparent = () => {
    if (!reparent) return;
    const child = todoById.get(reparent.childTaskId)?.title ?? '';
    const parent = todoById.get(reparent.parentTaskId)?.title ?? '';
    updateTodo.mutate(
      { id: reparent.childTaskId, data: { parent_id: reparent.parentTaskId } },
      {
        onSuccess: () =>
          addToast(
            'success',
            translateUi('“{{child}}” is now a sub-task of “{{parent}}”', { child, parent }),
          ),
        onError: () => addToast('error', translateUi('Could not move the task')),
      },
    );
    setReparent(null);
  };
  const toggleCollapsed = useCallback(
    (id: string) => {
      const next = new Set(collapsedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setCollapsedIds(next);
      updateTaskGraphLayout(layoutScope, { collapsedIds: [...next] });
    },
    [collapsedIds, layoutScope],
  );
  const expandAll = () => {
    setCollapsedIds(new Set());
    updateTaskGraphLayout(layoutScope, { collapsedIds: [] });
  };
  const resetLayout = () => {
    resetTaskGraphLayout(layoutScope);
    const defaults = collectDefaultCollapsedTaskIds(metadataTodos, projectRootTaskId);
    setCollapsedIds(defaults);
    updateTaskGraphLayout(layoutScope, { collapsedIds: [...defaults] });
    setLayoutResetVersion((version) => version + 1);
  };
  const elements = useMemo(
    () =>
      buildTaskGraphElements(graphTodos, {
        mode,
        collapsedIds,
        hideCompleted: showStatusControls ? hideCompleted : hideCompletedWithoutControls,
        relationships: graphRelationships,
        metadataTodos: graphMetadataTodos,
        projectRootIds,
        insightNodes: mode === 'execution' ? insightsQuery.data?.nodes : undefined,
        criticalPathTaskIds:
          mode === 'execution' ? insightsQuery.data?.summary.critical_path_task_ids : undefined,
        onToggleCollapse: toggleCollapsed,
      }),
    [
      collapsedIds,
      graphTodos,
      hideCompleted,
      insightsQuery.data,
      graphMetadataTodos,
      graphRelationships,
      hideCompletedWithoutControls,
      projectRootIds,
      mode,
      showStatusControls,
      toggleCollapsed,
    ],
  );
  const selectedInsight = useMemo(
    () => insightsQuery.data?.nodes.find((insight) => insight.task_id === selectedTaskId),
    [insightsQuery.data, selectedTaskId],
  );
  useEffect(() => {
    if (
      controlledTaskId === undefined &&
      selectedTaskId &&
      !elements.nodes.some((node) => node.id === selectedTaskId)
    ) {
      setSelectedTaskId(null);
    }
  }, [controlledTaskId, elements.nodes, selectedTaskId, setSelectedTaskId]);
  const handleStatusFilter = (value: string) => {
    const next: TasksStatusFilter = value === 'active' || value === 'completed' ? value : 'all';
    setStatusFilter(next);
    if (next === 'completed') setHideCompleted(false);
  };
  return (
    <section className="cc-task-flow" aria-label={translateUi('Task graph')}>
      <div className="cc-task-flow__toolbar">
        <SegmentedControl
          ariaLabel={translateUi('Graph mode')}
          options={GRAPH_MODE_OPTIONS.map((option) => ({
            ...option,
            label: translateUi(option.label),
          }))}
          value={mode}
          onChange={(value) => setMode(value as TaskGraphMode)}
        />

        <div className="cc-task-flow__filters">
          {showPlanningAction && (
            <button
              type="button"
              className="cc-btn cc-btn--primary cc-task-flow__ai-plan"
              onClick={() => setProposalOpen(true)}
              disabled={!serverUrl || planningTargets.length === 0}
              title={
                !serverUrl
                  ? translateUi('Connect to a server to use AI planning')
                  : translateUi('Generate a task graph proposal')
              }
            >
              <SparkleIcon size={14} />
              {translateUi(' AI plan\n          ')}
            </button>
          )}
          {!fixedProjectId && projectOptions.length > 0 && (
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              aria-label={translateUi('Filter graph by project')}
            >
              <option value="all">{translateUi('All projects')}</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          )}
          {showStatusControls && (
            <>
              <select
                value={statusFilter}
                onChange={(event) => handleStatusFilter(event.target.value)}
                aria-label={translateUi('Filter graph by status')}
              >
                <option value="all">{translateUi('All statuses')}</option>
                <option value="active">{translateUi('Active')}</option>
                <option value="completed">{translateUi('Done')}</option>
              </select>
              <label className="cc-task-flow__completed-toggle">
                <input
                  type="checkbox"
                  checked={hideCompleted}
                  onChange={(event) => setHideCompleted(event.target.checked)}
                  disabled={statusFilter === 'completed'}
                />
                {translateUi('\n                Hide completed\n              ')}
              </label>
            </>
          )}
          {collapsedIds.size > 0 && (
            <button type="button" className="cc-btn cc-btn--ghost" onClick={expandAll}>
              {translateUi('\n              Expand all\n            ')}
            </button>
          )}
          <button type="button" className="cc-btn cc-btn--ghost" onClick={resetLayout}>
            {translateUi('\n            Reset layout\n          ')}
          </button>
        </div>
      </div>

      <div className="cc-task-flow__summary">
        <span>
          {mode === 'structure'
            ? translateUi('Parent / child structure')
            : translateUi('Dependency execution order')}
        </span>
        <span>
          {elements.nodes.length}
          {translateUi(' nodes \u00B7 ')}
          {elements.edges.length}
          {translateUi(' connections\n        ')}
        </span>
        <span className={`cc-task-flow__legend-line cc-task-flow__legend-line--${mode}`} />
        <span>{mode === 'structure' ? translateUi('Sub-task') : translateUi('Depends on')}</span>
        {!isMobile && (
          <span className="cc-task-flow__hint">
            {translateUi("Drag from a card's right edge to another card to connect them")}
          </span>
        )}
      </div>

      {dependency.preview && (
        <div className="cc-task-flow__confirm">
          <InboxDependencyPreviewPanel
            preview={dependency.preview}
            todoById={todoById}
            isCreating={dependency.isCreating}
            onConfirm={() => void dependency.confirmPreview()}
            onCancel={dependency.dismissPreview}
          />
        </div>
      )}
      {reparent && (
        <div className="cc-task-flow__confirm">
          <section
            className="cc-inbox-triage__dependency-preview"
            aria-live="polite"
            aria-label={translateUi('Confirm sub-task')}
          >
            <strong>{translateUi('Make a sub-task')}</strong>
            <p>
              {translateUi('“{{child}}” will become a sub-task of “{{parent}}”.', {
                child: todoById.get(reparent.childTaskId)?.title ?? '',
                parent: todoById.get(reparent.parentTaskId)?.title ?? '',
              })}
            </p>
            <div>
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                disabled={updateTodo.isPending}
                onClick={confirmReparent}
              >
                {translateUi('Make sub-task')}
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--ghost"
                onClick={() => setReparent(null)}
              >
                {translateUi('Cancel')}
              </button>
            </div>
          </section>
        </div>
      )}

      {mode === 'execution' && (
        <TaskGraphHealthPanel
          insights={insightsQuery.data}
          isLoading={insightsQuery.isLoading}
          isError={insightsQuery.isError}
          visibleNodeCount={elements.nodes.length}
        />
      )}

      <div
        className={`cc-task-flow__workspace${selectedInsight ? ' cc-task-flow__workspace--details' : ''}`}
      >
        <TaskGraphView
          key={`${layoutScope}:${layoutResetVersion}`}
          nodes={elements.nodes}
          edges={elements.edges}
          isMobile={isMobile}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
          persistenceScope={layoutScope}
          onConnect={handleConnect}
        />
        {selectedInsight && insightsQuery.data && (
          <TaskGraphNodeInsightPanel
            insight={selectedInsight}
            allInsights={insightsQuery.data.nodes}
            generatedAt={insightsQuery.data.generated_at}
            onClose={() => setSelectedTaskId(null)}
            onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
          />
        )}
      </div>
      {proposalOpen && (
        <TaskGraphProposalDialog
          targets={planningTargets}
          initialTargetId={
            projectRootTaskId && planningTargets.some((todo) => todo.id === projectRootTaskId)
              ? projectRootTaskId
              : undefined
          }
          onOpenChange={setProposalOpen}
        />
      )}
    </section>
  );
}
