import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TaskStatus, TodoResponse } from '../../types/api';
import { TaskStatusSchema } from '../../types/schemas';
import usePlatform from '../../hooks/usePlatform';
import { useProjectsQuery, useTaskGraphInsightsQuery } from '../../hooks/queries';
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
import {
  createTaskGraphLayoutScope,
  loadTaskGraphLayout,
  resetTaskGraphLayout,
  updateTaskGraphLayout,
} from './taskGraphPersistence';
import { translateUi } from '../../i18n';
interface TaskGraphProps {
  todos: TodoResponse[];
  metadataTodos?: TodoResponse[];
  relationships?: GraphRelationshipLike[];
  hasExternalFilter?: boolean;
  fixedProjectId?: string;
  showPlanningAction?: boolean;
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
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
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
  const projectsQuery = useProjectsQuery();
  const projectOptions = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const selectedProject = useMemo(
    () => projectOptions.find((project) => project.id === projectId),
    [projectId, projectOptions],
  );
  const projectRootTaskId = selectedProject?.root_task_id ?? null;
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
    const matches = scopedTodos.filter((todo) => todo.status === statusFilter);
    return expandTaskGraphContext(scopedTodos, matches, graphRelationships);
  }, [graphRelationships, scopedTodos, statusFilter]);
  const graphMetadataTodos = useMemo(() => {
    const metadataIds = new Set(metadataTodos.map((todo) => todo.id));
    return [...metadataTodos, ...scopedTodos.filter((todo) => !metadataIds.has(todo.id))];
  }, [metadataTodos, scopedTodos]);
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
        hideCompleted,
        relationships: graphRelationships,
        metadataTodos: graphMetadataTodos,
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
      mode,
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
    const parsed = TaskStatusSchema.safeParse(value);
    const next = value === 'all' ? 'all' : parsed.success ? parsed.data : 'all';
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
          <select
            value={statusFilter}
            onChange={(event) => handleStatusFilter(event.target.value)}
            aria-label={translateUi('Filter graph by status')}
          >
            <option value="all">{translateUi('All statuses')}</option>
            <option value="pending">{translateUi('Todo')}</option>
            <option value="in_progress">{translateUi('In progress')}</option>
            <option value="completed">{translateUi('Done')}</option>
            <option value="cancelled">{translateUi('Cancelled')}</option>
          </select>
          <label className="cc-task-flow__completed-toggle">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(event) => setHideCompleted(event.target.checked)}
              disabled={statusFilter === 'completed'}
            />
            {translateUi('\n            Hide completed\n          ')}
          </label>
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
      </div>

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
