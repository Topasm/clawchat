import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { useToastStore } from '../stores/useToastStore';
import usePlatform from '../hooks/usePlatform';
import {
  useDeleteTodo,
  useExecutionProvidersQuery,
  useProjectsQuery,
  useSkillsQuery,
  useStartReadyTaskExecution,
  useTaskExecutionTelemetryQuery,
  useTaskGraphInsightsQuery,
  useTodosQuery,
  useToggleTodoComplete,
} from '../hooks/queries';
import apiClient from '../services/apiClient';
import InboxInspector from '../components/inbox/InboxInspector';
import InboxQueue from '../components/inbox/InboxQueue';
import InboxTriageTree from '../components/inbox/InboxTriageTree';
import type { ReadyTaskExecutionRequest } from '../components/inbox/ReadyTaskExecutionPanel';
import useInboxAiTriage from '../hooks/useInboxAiTriage';
import useInboxDependencyPreview from '../hooks/useInboxDependencyPreview';
import useInboxGraphRevision from '../hooks/useInboxGraphRevision';
import useInboxPlacement from '../hooks/useInboxPlacement';
import useInboxSections from '../hooks/useInboxSections';
import useInboxSelection from '../hooks/useInboxSelection';
import { translateUi } from '../i18n';
/**
 * Inbox triage: the capture queue on the left, the project tree in the middle, and the
 * inspector for the selected task on the right. The page wires the triage hooks to those
 * three views; every command and its optimistic graph revision lives in the hooks.
 */
export default function InboxPage() {
  const navigate = useNavigate();
  const { data: todos = [] } = useTodosQuery();
  const { data: projects = [] } = useProjectsQuery();
  const graphInsights = useTaskGraphInsightsQuery(null);
  const { data: executionTelemetry = [] } = useTaskExecutionTelemetryQuery();
  const startReadyExecution = useStartReadyTaskExecution();
  const { isMobile } = usePlatform();
  const addToast = useToastStore((s) => s.addToast);
  const toggleMutation = useToggleTodoComplete();
  const deleteMutation = useDeleteTodo();
  const sections = useInboxSections(todos);
  const selection = useInboxSelection(sections.needsOrganising);
  const { data: skillsData } = useSkillsQuery(Boolean(selection.selectedTaskId));
  const { data: executionProviders = [] } = useExecutionProvidersQuery(
    Boolean(selection.selectedTaskId),
  );
  const { placementRevision, setPlacementRevision, refreshPlacementRevision } =
    useInboxGraphRevision(graphInsights);
  const triage = useInboxAiTriage({
    placementRevision,
    setPlacementRevision,
    refreshPlacementRevision,
    batchTaskIds: selection.batchTaskIds,
    dropFromBatchSelection: selection.dropFromBatchSelection,
  });
  const placement = useInboxPlacement({
    todos,
    placementRevision,
    setPlacementRevision,
    onBeforePlacement: triage.dismissPreview,
    onBatchPlaced: selection.clearBatchSelection,
  });
  const dependency = useInboxDependencyPreview({
    todoById: sections.todoById,
    selectedTaskId: selection.selectedTaskId,
    selectTask: selection.selectTask,
    placementRevision,
    setPlacementRevision,
    refreshPlacementRevision,
  });
  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );
  const handleToggle = useCallback(
    (id: string) => {
      const todo = sections.todoById.get(id);
      if (todo) toggleMutation.mutate({ id, currentStatus: todo.status });
    },
    [sections.todoById, toggleMutation],
  );
  const handleOrganize = async (id: string) => {
    try {
      await apiClient.post(`/todos/${id}/organize`);
      addToast('info', translateUi('Organizing...'));
    } catch {
      addToast('error', translateUi('Failed to organize'));
    }
  };
  const handleRetry = async (id: string) => {
    try {
      await apiClient.post(`/todos/${id}/organize`);
      addToast('info', translateUi('Retrying...'));
    } catch {
      addToast('error', translateUi('Failed to retry'));
    }
  };
  const executionTelemetryByTaskId = useMemo(
    () => new Map(executionTelemetry.map((item) => [item.task_id, item])),
    [executionTelemetry],
  );
  const selectedTask = todos.find((todo) => todo.id === selection.selectedTaskId) ?? null;
  const selectedInsight = graphInsights.data?.nodes.find(
    (node) => node.task_id === selection.selectedTaskId,
  );
  const selectedProject = selectedTask?.project_id
    ? projects.find((project) => project.id === selectedTask.project_id)
    : undefined;
  const dependencyCandidates = useMemo(() => {
    if (!selectedTask) return [];
    const projectRoots = new Set(projects.flatMap((project) => project.root_task_id ?? []));
    return todos
      .filter((todo) => todo.id !== selectedTask.id && !projectRoots.has(todo.id))
      .sort((left, right) => {
        const leftSameProject = left.project_id === selectedTask.project_id ? 0 : 1;
        const rightSameProject = right.project_id === selectedTask.project_id ? 0 : 1;
        return leftSameProject - rightSameProject || left.title.localeCompare(right.title);
      });
  }, [projects, selectedTask, todos]);
  const treeProps = {
    projects,
    todos,
    selectedTaskId: selection.selectedTaskId,
    batchTaskIds: selection.batchTaskIds,
    telemetryByTaskId: executionTelemetryByTaskId,
    onSelectTask: selection.selectTask,
    onPlace: placement.placeTask,
    onPlaceBatch: placement.placeTaskBatch,
    onPreviewDependency: dependency.requestPreview,
    onOpenProject: (projectId: string) => navigate(`/projects/${projectId}`),
    // Captured under the project's root, the task lands in this project's
    // branch of the tree and skips the Inbox queue.
    onAddTask: (_projectId: string, rootTaskId: string | null) => {
      if (rootTaskId) useQuickCaptureStore.getState().open({ defaultParentId: rootTaskId });
    },
  };
  const treeBusy =
    placementRevision == null ||
    placement.isPlacing ||
    placement.isBatchPlacing ||
    dependency.isPreviewing ||
    dependency.isCreating;
  return (
    <div>
      <div
        className="cc-page-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <div>
          <div className="cc-page-header__title">{translateUi('Inbox')}</div>
          <div className="cc-page-header__subtitle">
            {sections.totalItems > 0
              ? translateUi('{{count}} items', { count: sections.totalItems })
              : translateUi('Capture first, organise later')}
          </div>
        </div>
        {!isMobile && (
          <button
            className="cc-btn cc-btn--primary"
            onClick={() => useQuickCaptureStore.getState().open()}
          >
            {translateUi('\n            + New\n          ')}
          </button>
        )}
      </div>

      <div className="cc-inbox-triage">
        <InboxQueue
          sections={sections}
          selection={selection}
          triage={triage}
          projects={projects}
          graphRevisionReady={placementRevision != null}
          isPlacing={placement.isPlacing}
          isBatchPlacing={placement.isBatchPlacing}
          dependencyBusy={dependency.isPreviewing || dependency.isCreating}
          isMobile={isMobile}
          onUnplaceTask={(taskId) => void placement.placeTask(taskId, null, null)}
          onUnplaceTasks={(taskIds) => void placement.placeTaskBatch(taskIds, null, null)}
          onToggleComplete={handleToggle}
          onDelete={handleDelete}
          onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
          onOrganize={handleOrganize}
          onRetry={handleRetry}
        />
        {!isMobile && (
          <InboxTriageTree
            {...treeProps}
            disabled={treeBusy || triage.isApplying || triage.isSuggesting}
          />
        )}
        <InboxInspector
          task={selectedTask}
          projects={projects}
          todoById={sections.todoById}
          insight={selectedInsight}
          telemetry={
            selection.selectedTaskId
              ? executionTelemetryByTaskId.get(selection.selectedTaskId)
              : undefined
          }
          summary={graphInsights.data?.summary}
          project={selectedProject}
          skills={skillsData?.skills ?? []}
          providers={executionProviders}
          isStartingExecution={startReadyExecution.isPending}
          dependency={dependency}
          dependencyCandidates={dependencyCandidates}
          graphRevisionReady={placementRevision != null}
          isPlacing={placement.isPlacing}
          mobileTree={isMobile ? <InboxTriageTree {...treeProps} disabled={treeBusy} /> : undefined}
          onStartExecution={(taskId: string, request: ReadyTaskExecutionRequest) =>
            startReadyExecution.mutateAsync({ todoId: taskId, ...request })
          }
          onReturnToInbox={(taskId) => void placement.placeTask(taskId, null, null)}
          onNavigate={(path) => navigate(path)}
        />
      </div>
    </div>
  );
}
