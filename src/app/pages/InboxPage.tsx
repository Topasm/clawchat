import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { useToastStore } from '../stores/useToastStore';
import usePlatform from '../hooks/usePlatform';
import {
  useDeleteTodo,
  usePlaceTodo,
  usePlaceTodoGroups,
  usePlaceTodosBatch,
  usePreviewInboxTriage,
  useCreateTaskDependency,
  usePreviewTaskDependency,
  useProjectsQuery,
  useTaskGraphInsightsQuery,
  useTaskExecutionTelemetryQuery,
  useTodosQuery,
  useToggleTodoComplete,
  useUndoTodoPlacement,
} from '../hooks/queries';
import { queryKeys } from '../hooks/queries';
import TaskCard from '../components/shared/TaskCard';
import SectionHeader from '../components/shared/SectionHeader';
import EmptyState from '../components/shared/EmptyState';
import { InboxTrayIcon } from '../components/shared/Icons';
import apiClient from '../services/apiClient';
import type {
  InboxTriagePreviewResponse,
  TaskDependencyPreviewResponse,
  TodoResponse,
} from '../types/schemas';
import { isTerminalTaskStatus } from '../utils/taskStatus';
import { buildInboxTriagePlacementGroups } from '../utils/inboxTriage';
import InboxTriageTree, {
  INBOX_DEPENDENCY_DRAG_TYPE,
  INBOX_TASK_BATCH_DRAG_TYPE,
  INBOX_TASK_DRAG_TYPE,
} from '../components/inbox/InboxTriageTree';
import { getTaskExecutionBadges } from '../utils/taskExecutionTelemetry';

function transferHasType(event: React.DragEvent, type: string): boolean {
  return (
    Array.from(event.dataTransfer.types ?? []).includes(type) ||
    Boolean(event.dataTransfer.getData(type))
  );
}

function transferredBatchTaskIds(event: React.DragEvent): string[] {
  const value = event.dataTransfer.getData(INBOX_TASK_BATCH_DRAG_TYPE);
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((taskId) => typeof taskId === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function QuestionnaireCard({ task }: { task: TodoResponse }) {
  const questions = task.clarification_questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const handleAnswerChange = (index: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [String(index)]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await apiClient.post(`/todos/${task.id}/answer-questions`, { answers });
      addToast('info', 'Planning with your answers...');
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
    } catch {
      addToast('error', 'Failed to submit answers');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    setSubmitting(true);
    try {
      await apiClient.post(`/todos/${task.id}/skip-questions`);
      addToast('info', 'Skipping questions, planning...');
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
    } catch {
      addToast('error', 'Failed to skip questions');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cc-inbox-card cc-inbox-card--questioning">
      <div className="cc-inbox-card__questioning-header">{task.title}</div>
      <div className="cc-inbox-card__questioning-body">
        {questions.map((question, index) => (
          <div key={index} className="cc-inbox-card__question-row">
            <label className="cc-inbox-card__question-label">{question}</label>
            <input
              className="cc-inbox-card__question-input"
              type="text"
              placeholder="Your answer..."
              value={answers[String(index)] ?? ''}
              onChange={(e) => handleAnswerChange(index, e.target.value)}
              disabled={submitting}
            />
          </div>
        ))}
      </div>
      <div className="cc-inbox-card__actions">
        <button
          className="cc-btn cc-btn--primary"
          style={{ fontSize: 12 }}
          onClick={handleSubmit}
          disabled={submitting}
        >
          Submit Answers
        </button>
        <button
          className="cc-btn cc-btn--secondary"
          style={{ fontSize: 12 }}
          onClick={handleSkip}
          disabled={submitting}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const navigate = useNavigate();
  const { data: todos = [] } = useTodosQuery();
  const { data: projects = [] } = useProjectsQuery();
  const graphInsights = useTaskGraphInsightsQuery(null);
  const { data: executionTelemetry = [] } = useTaskExecutionTelemetryQuery();
  const { isMobile } = usePlatform();
  const addToast = useToastStore((s) => s.addToast);
  const toggleMutation = useToggleTodoComplete();
  const deleteMutation = useDeleteTodo();
  const placeMutation = usePlaceTodo();
  const placeBatchMutation = usePlaceTodosBatch();
  const placeGroupsMutation = usePlaceTodoGroups();
  const triagePreviewMutation = usePreviewInboxTriage();
  const undoPlacement = useUndoTodoPlacement();
  const previewDependency = usePreviewTaskDependency();
  const createDependency = useCreateTaskDependency();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedInboxTaskIds, setSelectedInboxTaskIds] = useState<string[]>([]);
  const [placementRevision, setPlacementRevision] = useState<number | null>(null);
  const [dependencyPreview, setDependencyPreview] = useState<TaskDependencyPreviewResponse | null>(
    null,
  );
  const [triagePreview, setTriagePreview] = useState<InboxTriagePreviewResponse | null>(null);
  const [selectedTriageTaskIds, setSelectedTriageTaskIds] = useState<string[]>([]);

  useEffect(() => {
    if (graphInsights.data) setPlacementRevision(graphInsights.data.graph_revision);
  }, [graphInsights.data]);

  useEffect(() => {
    if (dependencyPreview && dependencyPreview.dependent_task_id !== selectedTaskId) {
      setDependencyPreview(null);
    }
  }, [dependencyPreview, selectedTaskId]);

  useEffect(() => {
    if (triagePreview && placementRevision !== triagePreview.base_graph_revision) {
      setTriagePreview(null);
      setSelectedTriageTaskIds([]);
    }
  }, [placementRevision, triagePreview]);

  const inboxData = useMemo(() => {
    const processing: TodoResponse[] = [];
    const questioning: TodoResponse[] = [];
    const planReady: TodoResponse[] = [];
    const errors: TodoResponse[] = [];
    const needsOrganising: TodoResponse[] = [];
    const childCountByParent = new Map<string, number>();
    const todoById = new Map<string, TodoResponse>();

    for (const todo of todos) {
      todoById.set(todo.id, todo);
      if (todo.parent_id) {
        childCountByParent.set(todo.parent_id, (childCountByParent.get(todo.parent_id) ?? 0) + 1);
      }
      if (isTerminalTaskStatus(todo.status)) continue;

      if (todo.inbox_state === 'classifying' || todo.inbox_state === 'planning') {
        processing.push(todo);
      } else if (todo.inbox_state === 'questioning') {
        questioning.push(todo);
      } else if (todo.inbox_state === 'plan_ready') {
        planReady.push(todo);
      } else if (todo.inbox_state === 'error') {
        errors.push(todo);
      } else if (
        todo.inbox_state === 'captured' ||
        ((!todo.inbox_state || todo.inbox_state === 'none') &&
          !todo.project_id &&
          !todo.due_date &&
          !todo.parent_id)
      ) {
        needsOrganising.push(todo);
      }
    }

    return {
      processing,
      questioning,
      planReady,
      errors,
      needsOrganising,
      childCountByParent,
      todoById,
    };
  }, [todos]);

  const {
    processing,
    questioning,
    planReady,
    errors,
    needsOrganising,
    childCountByParent,
    todoById,
  } = inboxData;

  const batchTaskIds = useMemo(
    () =>
      needsOrganising
        .filter((todo) => selectedInboxTaskIds.includes(todo.id))
        .map((todo) => todo.id),
    [needsOrganising, selectedInboxTaskIds],
  );

  const toggleBatchTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setSelectedInboxTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((selectedId) => selectedId !== taskId)
        : [...current, taskId],
    );
  };

  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  const handleToggle = useCallback(
    (id: string) => {
      const todo = todoById.get(id);
      if (todo) toggleMutation.mutate({ id, currentStatus: todo.status });
    },
    [todoById, toggleMutation],
  );

  const totalItems =
    processing.length +
    questioning.length +
    planReady.length +
    needsOrganising.length +
    errors.length;

  const selectedTask = todos.find((todo) => todo.id === selectedTaskId) ?? null;
  const executionTelemetryByTaskId = useMemo(
    () => new Map(executionTelemetry.map((item) => [item.task_id, item])),
    [executionTelemetry],
  );
  const selectedExecutionTelemetry = selectedTaskId
    ? executionTelemetryByTaskId.get(selectedTaskId)
    : undefined;
  const selectedExecutionBadges = getTaskExecutionBadges(selectedExecutionTelemetry);

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

  const dependencyErrorMessage = (error: unknown): string => {
    const response = (
      error as {
        response?: {
          status?: number;
          data?: {
            error?: {
              message?: string;
              details?: { cycle_task_ids?: string[] };
            };
          };
        };
      }
    ).response;
    const cycleIds = response?.data?.error?.details?.cycle_task_ids;
    if (cycleIds?.length) {
      const path = cycleIds.map((id) => todoById.get(id)?.title ?? id).join(' → ');
      return `Cannot connect these tasks because it creates a cycle: ${path}`;
    }
    if (response?.status === 409) return 'The graph changed. Refreshing before you try again.';
    return response?.data?.error?.message ?? 'Could not validate this dependency';
  };

  const handleDependencyPreview = async (dependentTaskId: string, prerequisiteTaskId: string) => {
    if (placementRevision == null) {
      addToast('warning', 'The current graph revision is still loading');
      return;
    }
    setSelectedTaskId(dependentTaskId);
    try {
      const result = await previewDependency.mutateAsync({
        dependent_task_id: dependentTaskId,
        prerequisite_task_id: prerequisiteTaskId,
        expected_graph_revision: placementRevision,
      });
      setDependencyPreview(result);
    } catch (error) {
      setDependencyPreview(null);
      addToast('error', dependencyErrorMessage(error));
      if ((error as { response?: { status?: number } }).response?.status === 409) {
        const refreshed = await graphInsights.refetch();
        if (refreshed.data) setPlacementRevision(refreshed.data.graph_revision);
      }
    }
  };

  const handleDependencyConfirm = async () => {
    if (!dependencyPreview) return;
    try {
      const result = await createDependency.mutateAsync({
        dependent_task_id: dependencyPreview.dependent_task_id,
        prerequisite_task_id: dependencyPreview.prerequisite_task_id,
        expected_graph_revision: dependencyPreview.base_graph_revision,
      });
      const dependent = todoById.get(result.dependent_task_id)?.title ?? 'Task';
      const prerequisite = todoById.get(result.prerequisite_task_id)?.title ?? 'prerequisite';
      setPlacementRevision(result.graph_revision);
      setDependencyPreview(null);
      addToast('success', `“${dependent}” now waits for “${prerequisite}”`);
    } catch (error) {
      setDependencyPreview(null);
      addToast('error', dependencyErrorMessage(error));
      if ((error as { response?: { status?: number } }).response?.status === 409) {
        const refreshed = await graphInsights.refetch();
        if (refreshed.data) setPlacementRevision(refreshed.data.graph_revision);
      }
    }
  };

  const handlePlacement = async (
    taskId: string,
    projectId: string | null,
    parentId: string | null,
    beforeId?: string,
  ) => {
    if (placementRevision == null) {
      addToast('warning', 'The current graph revision is still loading');
      return;
    }
    setTriagePreview(null);
    setSelectedTriageTaskIds([]);
    try {
      const moved = todos.find((todo) => todo.id === taskId);
      const nextInboxState =
        projectId === null
          ? 'captured'
          : moved?.inbox_state && !['none', 'captured'].includes(moved.inbox_state)
            ? moved.inbox_state
            : 'none';
      const result = await placeMutation.mutateAsync({
        id: taskId,
        placement: {
          project_id: projectId,
          parent_id: parentId,
          before_id: beforeId ?? null,
          inbox_state: nextInboxState,
          expected_graph_revision: placementRevision,
        },
      });
      setPlacementRevision(result.graph_revision);
      const impact = result.insights_delta;
      const impactLabel = impact
        ? ` · Ready ${impact.ready_count >= 0 ? '+' : ''}${impact.ready_count} · Blocked ${impact.blocked_count >= 0 ? '+' : ''}${impact.blocked_count}`
        : '';
      addToast('success', `Moved “${moved?.title ?? 'Task'}”${impactLabel}`, {
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: () => {
            void undoPlacement
              .mutateAsync(result.change_set_id)
              .then((undone) => {
                setPlacementRevision(undone.graph_revision);
                addToast('info', 'Placement reverted');
              })
              .catch((error: unknown) => {
                const response = (
                  error as {
                    response?: { status?: number; data?: { error?: { message?: string } } };
                  }
                ).response;
                addToast(
                  'error',
                  response?.data?.error?.message ??
                    (response?.status === 409
                      ? 'Could not undo after later task changes'
                      : 'Could not undo placement'),
                );
              });
          },
        },
      });
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Could not place this task';
      addToast('error', message);
    }
  };

  const handleBatchPlacement = async (
    taskIds: string[],
    projectId: string | null,
    parentId: string | null,
    beforeId?: string,
  ) => {
    if (placementRevision == null) {
      addToast('warning', 'The current graph revision is still loading');
      return;
    }
    setTriagePreview(null);
    setSelectedTriageTaskIds([]);
    try {
      const result = await placeBatchMutation.mutateAsync({
        todo_ids: taskIds,
        project_id: projectId,
        parent_id: parentId,
        before_id: beforeId ?? null,
        inbox_state: projectId === null ? 'captured' : 'none',
        expected_graph_revision: placementRevision,
      });
      setPlacementRevision(result.graph_revision);
      setSelectedInboxTaskIds([]);
      const impact = result.insights_delta;
      const impactLabel = impact
        ? ` · Ready ${impact.ready_count >= 0 ? '+' : ''}${impact.ready_count} · Blocked ${impact.blocked_count >= 0 ? '+' : ''}${impact.blocked_count}`
        : '';
      addToast('success', `Moved ${taskIds.length} tasks${impactLabel}`, {
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: () => {
            void undoPlacement
              .mutateAsync(result.change_set_id)
              .then((undone) => {
                setPlacementRevision(undone.graph_revision);
                addToast('info', `${taskIds.length} task placements reverted`);
              })
              .catch((error: unknown) => {
                const response = (
                  error as {
                    response?: { status?: number; data?: { error?: { message?: string } } };
                  }
                ).response;
                addToast(
                  'error',
                  response?.data?.error?.message ??
                    (response?.status === 409
                      ? 'Could not undo after later task changes'
                      : 'Could not undo batch placement'),
                );
              });
          },
        },
      });
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Could not place these tasks';
      addToast('error', message);
    }
  };

  const refreshPlacementRevision = async () => {
    const refreshed = await graphInsights.refetch();
    if (refreshed.data) setPlacementRevision(refreshed.data.graph_revision);
  };

  const triageErrorMessage = (error: unknown, fallback: string): string =>
    (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
      ?.message ?? fallback;

  const handleTriagePreview = async () => {
    if (placementRevision == null || batchTaskIds.length === 0) {
      addToast('warning', 'Select Inbox tasks after the graph revision finishes loading');
      return;
    }
    try {
      const preview = await triagePreviewMutation.mutateAsync({
        todo_ids: batchTaskIds,
        expected_graph_revision: placementRevision,
      });
      setTriagePreview(preview);
      setSelectedTriageTaskIds(preview.suggestions.map((suggestion) => suggestion.task_id));
      if (preview.suggestions.length === 0) {
        addToast('info', 'AI could not confidently place the selected tasks');
      }
    } catch (error) {
      setTriagePreview(null);
      setSelectedTriageTaskIds([]);
      addToast('error', triageErrorMessage(error, 'Could not generate placement suggestions'));
      if ((error as { response?: { status?: number } }).response?.status === 409) {
        await refreshPlacementRevision();
      }
    }
  };

  const handleApplyTriagePreview = async () => {
    if (!triagePreview) return;
    const selected = new Set(selectedTriageTaskIds);
    const suggestions = triagePreview.suggestions.filter((suggestion) =>
      selected.has(suggestion.task_id),
    );
    if (suggestions.length === 0) {
      addToast('warning', 'Select at least one suggestion to apply');
      return;
    }
    let groups;
    try {
      groups = buildInboxTriagePlacementGroups(triagePreview, selectedTriageTaskIds);
    } catch (error) {
      addToast(
        'error',
        error instanceof Error ? error.message : 'The placement preview is invalid',
      );
      return;
    }
    try {
      const result = await placeGroupsMutation.mutateAsync({
        groups,
        expected_graph_revision: triagePreview.base_graph_revision,
      });
      const appliedIds = new Set(suggestions.map((suggestion) => suggestion.task_id));
      setPlacementRevision(result.graph_revision);
      setSelectedInboxTaskIds((current) => current.filter((taskId) => !appliedIds.has(taskId)));
      setTriagePreview(null);
      setSelectedTriageTaskIds([]);
      addToast('success', `Applied ${suggestions.length} AI placement suggestions`, {
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: () => {
            void undoPlacement
              .mutateAsync(result.change_set_id)
              .then((undone) => {
                setPlacementRevision(undone.graph_revision);
                addToast('info', 'AI placements reverted');
              })
              .catch((error: unknown) => {
                addToast('error', triageErrorMessage(error, 'Could not undo AI placements'));
              });
          },
        },
      });
    } catch (error) {
      addToast('error', triageErrorMessage(error, 'Could not apply placement suggestions'));
      if ((error as { response?: { status?: number } }).response?.status === 409) {
        setTriagePreview(null);
        setSelectedTriageTaskIds([]);
        await refreshPlacementRevision();
      }
    }
  };

  const selectedInsight = graphInsights.data?.nodes.find((node) => node.task_id === selectedTaskId);

  const handleOrganize = async (id: string) => {
    try {
      await apiClient.post(`/todos/${id}/organize`);
      addToast('info', 'Organizing...');
    } catch {
      addToast('error', 'Failed to organize');
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await apiClient.post(`/todos/${id}/organize`);
      addToast('info', 'Retrying...');
    } catch {
      addToast('error', 'Failed to retry');
    }
  };

  return (
    <div>
      <div
        className="cc-page-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <div>
          <div className="cc-page-header__title">Inbox</div>
          <div className="cc-page-header__subtitle">
            {totalItems > 0
              ? `${totalItems} item${totalItems !== 1 ? 's' : ''}`
              : 'Capture first, organise later'}
          </div>
        </div>
        {!isMobile && (
          <button
            className="cc-btn cc-btn--primary"
            onClick={() => useQuickCaptureStore.getState().open()}
          >
            + New
          </button>
        )}
      </div>

      <div className="cc-inbox-triage">
        <main className="cc-inbox-triage__queue">
          <div
            className="cc-inbox-triage__inbox-target"
            onDragOver={(event) => {
              if (
                transferHasType(event, INBOX_TASK_DRAG_TYPE) ||
                transferHasType(event, INBOX_TASK_BATCH_DRAG_TYPE)
              ) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              const batchIds = transferredBatchTaskIds(event);
              if (batchIds.length > 1 && !placeBatchMutation.isPending) {
                event.preventDefault();
                void handleBatchPlacement(batchIds, null, null);
                return;
              }
              const taskId = event.dataTransfer.getData(INBOX_TASK_DRAG_TYPE);
              if (taskId && !placeMutation.isPending) {
                event.preventDefault();
                void handlePlacement(taskId, null, null);
              }
            }}
          >
            Inbox · drop here to unplace
          </div>
          {/* Planning now (classifying/planning) */}
          {processing.length > 0 && (
            <SectionHeader
              title="Planning now"
              count={processing.length}
              variant="default"
              defaultOpen
            >
              {processing.map((task) => (
                <div key={task.id} className="cc-inbox-card cc-inbox-card--planning">
                  <div className="cc-inbox-card__spinner" />
                  <TaskCard
                    task={task}
                    onToggle={() => handleToggle(task.id)}
                    onClick={() => navigate(`/tasks/${task.id}`)}
                    onDelete={() => handleDelete(task.id)}
                  />
                </div>
              ))}
            </SectionHeader>
          )}

          {/* Answer questions (questioning) */}
          {questioning.length > 0 && (
            <SectionHeader
              title="Answer questions"
              count={questioning.length}
              variant="accent"
              defaultOpen
            >
              {questioning.map((task) => (
                <QuestionnaireCard key={task.id} task={task} />
              ))}
            </SectionHeader>
          )}

          {/* Review suggestion (plan_ready) */}
          {planReady.length > 0 && (
            <SectionHeader
              title="Review suggestion"
              count={planReady.length}
              variant="accent"
              defaultOpen
            >
              {planReady.map((task) => (
                <div key={task.id} className="cc-inbox-card cc-inbox-card--review">
                  <TaskCard
                    task={task}
                    onToggle={() => handleToggle(task.id)}
                    onClick={() => navigate(`/tasks/${task.id}`)}
                    onDelete={() => handleDelete(task.id)}
                  />
                  <div className="cc-inbox-card__actions">
                    <button
                      className="cc-btn cc-btn--primary"
                      style={{ fontSize: 12 }}
                      onClick={() => navigate(`/tasks/${task.id}`)}
                    >
                      Review
                    </button>
                  </div>
                </div>
              ))}
            </SectionHeader>
          )}

          {/* Needs organizing (captured) */}
          {needsOrganising.length > 0 && (
            <SectionHeader
              title="Needs organizing"
              count={needsOrganising.length}
              variant="accent"
              defaultOpen
            >
              <div className="cc-inbox-triage__batch-bar" aria-live="polite">
                <span>
                  {batchTaskIds.length
                    ? `${batchTaskIds.length} selected`
                    : 'Select tasks to move them together'}
                </span>
                <div>
                  <button
                    type="button"
                    className="cc-btn cc-btn--secondary"
                    disabled={
                      batchTaskIds.length === 0 ||
                      placementRevision == null ||
                      triagePreviewMutation.isPending ||
                      placeGroupsMutation.isPending
                    }
                    onClick={() => void handleTriagePreview()}
                  >
                    {triagePreviewMutation.isPending ? 'Suggesting…' : 'AI suggest'}
                  </button>
                  <button
                    type="button"
                    className="cc-btn cc-btn--ghost"
                    disabled={batchTaskIds.length === needsOrganising.length}
                    onClick={() => {
                      setSelectedInboxTaskIds(needsOrganising.map((todo) => todo.id));
                      setSelectedTaskId(needsOrganising[0]?.id ?? null);
                    }}
                  >
                    Select all
                  </button>
                  {batchTaskIds.length > 0 && (
                    <button
                      type="button"
                      className="cc-btn cc-btn--ghost"
                      onClick={() => setSelectedInboxTaskIds([])}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              {triagePreview && (
                <div className="cc-inbox-triage__ai-preview" aria-live="polite">
                  <div className="cc-inbox-triage__ai-preview-header">
                    <div>
                      <strong>AI placement preview</strong>
                      <span>
                        {triagePreview.suggestions.length} suggested
                        {triagePreview.proposed_workstreams.length > 0
                          ? ` · ${triagePreview.proposed_workstreams.length} new Workstream${triagePreview.proposed_workstreams.length === 1 ? '' : 's'}`
                          : ''}
                        {triagePreview.model_provider ? ` · ${triagePreview.model_provider}` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="cc-btn cc-btn--ghost"
                      onClick={() => {
                        setTriagePreview(null);
                        setSelectedTriageTaskIds([]);
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                  {triagePreview.proposed_workstreams.map((workstream) => {
                    const project = projects.find((item) => item.id === workstream.project_id);
                    const parent = workstream.parent_id ? todoById.get(workstream.parent_id) : null;
                    const selectedCount = triagePreview.suggestions.filter(
                      (suggestion) =>
                        suggestion.proposed_parent_key === workstream.key &&
                        selectedTriageTaskIds.includes(suggestion.task_id),
                    ).length;
                    return (
                      <div
                        key={workstream.key}
                        className="cc-inbox-triage__ai-workstream"
                        aria-label={`Proposed Workstream ${workstream.title}`}
                      >
                        <span>AI proposed Workstream</span>
                        <strong>{workstream.title}</strong>
                        <small>
                          {project?.title ?? workstream.project_id}
                          {parent ? ` / ${parent.title}` : ' / Project root'} ·{' '}
                          {Math.round(workstream.confidence * 100)}% · {selectedCount} selected task
                          {selectedCount === 1 ? '' : 's'}
                        </small>
                        <small>{workstream.reason}</small>
                      </div>
                    );
                  })}
                  {triagePreview.suggestions.map((suggestion) => {
                    const project = projects.find((item) => item.id === suggestion.project_id);
                    const parent = suggestion.parent_id ? todoById.get(suggestion.parent_id) : null;
                    const proposed = suggestion.proposed_parent_key
                      ? triagePreview.proposed_workstreams.find(
                          (workstream) => workstream.key === suggestion.proposed_parent_key,
                        )
                      : null;
                    return (
                      <label key={suggestion.task_id} className="cc-inbox-triage__ai-suggestion">
                        <input
                          type="checkbox"
                          checked={selectedTriageTaskIds.includes(suggestion.task_id)}
                          onChange={() =>
                            setSelectedTriageTaskIds((current) =>
                              current.includes(suggestion.task_id)
                                ? current.filter((taskId) => taskId !== suggestion.task_id)
                                : [...current, suggestion.task_id],
                            )
                          }
                        />
                        <span>
                          <strong>
                            {todoById.get(suggestion.task_id)?.title ?? suggestion.task_id}
                          </strong>
                          <small>
                            → {project?.title ?? suggestion.project_id}
                            {proposed
                              ? ` / ${proposed.title} (new)`
                              : parent
                                ? ` / ${parent.title}`
                                : ' / Project root'}{' '}
                            · {Math.round(suggestion.confidence * 100)}%
                          </small>
                          <small>{suggestion.reason}</small>
                        </span>
                      </label>
                    );
                  })}
                  {triagePreview.unassigned_task_ids.length > 0 && (
                    <p>
                      No confident location: {triagePreview.unassigned_task_ids.length} task
                      {triagePreview.unassigned_task_ids.length === 1 ? '' : 's'}
                    </p>
                  )}
                  <button
                    type="button"
                    className="cc-btn cc-btn--primary"
                    disabled={selectedTriageTaskIds.length === 0 || placeGroupsMutation.isPending}
                    onClick={() => void handleApplyTriagePreview()}
                  >
                    {placeGroupsMutation.isPending
                      ? 'Applying…'
                      : `Apply selected (${selectedTriageTaskIds.length})`}
                  </button>
                </div>
              )}
              {needsOrganising.map((task) => {
                const isBatchSelected = batchTaskIds.includes(task.id);
                return (
                  <div
                    key={task.id}
                    className={`cc-inbox-card${selectedTaskId === task.id ? ' cc-inbox-card--selected' : ''}${isBatchSelected ? ' cc-inbox-card--batch-selected' : ''}`}
                    draggable={
                      !placeMutation.isPending &&
                      !placeBatchMutation.isPending &&
                      !placeGroupsMutation.isPending
                    }
                    onDragStart={(event) => {
                      if (isBatchSelected && batchTaskIds.length > 1) {
                        event.dataTransfer.setData(
                          INBOX_TASK_BATCH_DRAG_TYPE,
                          JSON.stringify(batchTaskIds),
                        );
                      } else {
                        event.dataTransfer.setData(INBOX_TASK_DRAG_TYPE, task.id);
                      }
                      event.dataTransfer.effectAllowed = 'move';
                      setSelectedTaskId(task.id);
                    }}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <TaskCard
                      task={task}
                      onToggle={() => handleToggle(task.id)}
                      onClick={() => setSelectedTaskId(task.id)}
                      onDelete={() => handleDelete(task.id)}
                      subTaskCount={childCountByParent.get(task.id) ?? 0}
                    />
                    <div className="cc-inbox-card__actions">
                      <label className="cc-inbox-batch-check">
                        <input
                          type="checkbox"
                          checked={isBatchSelected}
                          aria-label={`Select ${task.title} for batch placement`}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => toggleBatchTask(task.id)}
                        />
                        Batch
                      </label>
                      <button
                        className="cc-inbox-dependency-handle"
                        type="button"
                        draggable={!previewDependency.isPending && !createDependency.isPending}
                        aria-label={`Drag ${task.title} to a task that must finish first`}
                        title="Connect a prerequisite"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.setData(INBOX_DEPENDENCY_DRAG_TYPE, task.id);
                          event.dataTransfer.effectAllowed = 'link';
                          setSelectedTaskId(task.id);
                        }}
                      >
                        <span aria-hidden="true">↝</span> Prerequisite
                      </button>
                      <button
                        className="cc-btn cc-btn--ghost"
                        type="button"
                        aria-label={`Select ${task.title} for placement`}
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        Select
                      </button>
                      <button
                        className="cc-btn cc-btn--secondary"
                        style={{ fontSize: 12 }}
                        onClick={() => handleOrganize(task.id)}
                      >
                        Organize
                      </button>
                    </div>
                  </div>
                );
              })}
            </SectionHeader>
          )}

          {/* Failed (error) */}
          {errors.length > 0 && (
            <SectionHeader
              title="Failed"
              count={errors.length}
              variant="warning"
              defaultOpen={false}
            >
              {errors.map((task) => (
                <div key={task.id} className="cc-inbox-card cc-inbox-card--error">
                  <TaskCard
                    task={task}
                    onToggle={() => handleToggle(task.id)}
                    onClick={() => navigate(`/tasks/${task.id}`)}
                    onDelete={() => handleDelete(task.id)}
                  />
                  <div className="cc-inbox-card__actions">
                    <button
                      className="cc-btn cc-btn--danger"
                      style={{ fontSize: 12 }}
                      onClick={() => handleRetry(task.id)}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ))}
            </SectionHeader>
          )}

          {totalItems === 0 && (
            <EmptyState
              icon={<InboxTrayIcon size={20} />}
              message={
                isMobile
                  ? 'Inbox is clear. Add something when it comes up.'
                  : 'Inbox is clear. Capture a task or note when something comes up.'
              }
            />
          )}
        </main>
        {!isMobile && (
          <InboxTriageTree
            projects={projects}
            todos={todos}
            selectedTaskId={selectedTaskId}
            batchTaskIds={batchTaskIds}
            telemetryByTaskId={executionTelemetryByTaskId}
            disabled={
              placementRevision == null ||
              placeMutation.isPending ||
              placeBatchMutation.isPending ||
              placeGroupsMutation.isPending ||
              triagePreviewMutation.isPending ||
              previewDependency.isPending ||
              createDependency.isPending
            }
            onSelectTask={setSelectedTaskId}
            onPlace={handlePlacement}
            onPlaceBatch={handleBatchPlacement}
            onPreviewDependency={handleDependencyPreview}
          />
        )}
        <aside className="cc-inbox-triage__inspector" aria-label="Selected task">
          {selectedTask ? (
            <>
              <span>Selected task</span>
              <h2>{selectedTask.title}</h2>
              <dl>
                <div>
                  <dt>Project</dt>
                  <dd>
                    {projects.find((project) => project.id === selectedTask.project_id)?.title ??
                      'Inbox'}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{selectedTask.status.replace('_', ' ')}</dd>
                </div>
                {selectedInsight && (
                  <div>
                    <dt>Execution</dt>
                    <dd>{selectedInsight.execution_state.replace('_', ' ')}</dd>
                  </div>
                )}
              </dl>
              {graphInsights.data && (
                <p className="cc-inbox-triage__impact">
                  Ready {graphInsights.data.summary.ready_count} · Blocked{' '}
                  {graphInsights.data.summary.blocked_count} · Critical path{' '}
                  {graphInsights.data.summary.critical_path_minutes == null
                    ? 'unknown'
                    : `${graphInsights.data.summary.critical_path_minutes}m`}
                </p>
              )}
              {selectedExecutionTelemetry && (
                <section
                  className="cc-inbox-triage__execution-telemetry"
                  aria-label="Task execution activity"
                >
                  <div className="cc-inbox-triage__execution-heading">
                    <strong>Execution activity</strong>
                    <div className="cc-inbox-tree__telemetry">
                      {selectedExecutionBadges.map((badge) => (
                        <span
                          key={badge.key}
                          className="cc-inbox-tree__telemetry-badge"
                          data-tone={badge.tone}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  {selectedExecutionTelemetry.latest_run_progress_message && (
                    <p>{selectedExecutionTelemetry.latest_run_progress_message}</p>
                  )}
                  {selectedExecutionTelemetry.latest_artifact_title && (
                    <small>
                      Latest artifact: {selectedExecutionTelemetry.latest_artifact_title}
                    </small>
                  )}
                  <div className="cc-inbox-triage__execution-actions">
                    {selectedExecutionTelemetry.latest_run_id && (
                      <button
                        type="button"
                        className="cc-btn cc-btn--ghost"
                        onClick={() =>
                          navigate(`/runs?run_id=${selectedExecutionTelemetry.latest_run_id}`)
                        }
                      >
                        Open run
                      </button>
                    )}
                    {selectedExecutionTelemetry.pending_review_count > 0 && (
                      <button
                        type="button"
                        className="cc-btn cc-btn--ghost"
                        onClick={() =>
                          navigate(
                            `/review${selectedTask.project_id ? `?project_id=${selectedTask.project_id}` : ''}`,
                          )
                        }
                      >
                        Review
                      </button>
                    )}
                    {selectedExecutionTelemetry.artifact_count > 0 && selectedTask.project_id && (
                      <button
                        type="button"
                        className="cc-btn cc-btn--ghost"
                        onClick={() =>
                          navigate(`/projects/${selectedTask.project_id}?section=artifacts`)
                        }
                      >
                        Artifacts
                      </button>
                    )}
                  </div>
                </section>
              )}
              <div className="cc-inbox-triage__dependency-picker">
                <label htmlFor="inbox-prerequisite-select">Must wait for</label>
                <select
                  id="inbox-prerequisite-select"
                  value=""
                  disabled={
                    placementRevision == null ||
                    previewDependency.isPending ||
                    createDependency.isPending
                  }
                  onChange={(event) => {
                    const prerequisiteTaskId = event.target.value;
                    if (prerequisiteTaskId) {
                      void handleDependencyPreview(selectedTask.id, prerequisiteTaskId);
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
              {dependencyPreview && (
                <section
                  className="cc-inbox-triage__dependency-preview"
                  aria-live="polite"
                  aria-label="Dependency impact preview"
                >
                  <strong>Confirm dependency</strong>
                  <p>
                    “{todoById.get(dependencyPreview.dependent_task_id)?.title ?? 'Task'}” will wait
                    for “
                    {todoById.get(dependencyPreview.prerequisite_task_id)?.title ?? 'prerequisite'}
                    ”.
                  </p>
                  {dependencyPreview.insights_delta && (
                    <p>
                      Ready {dependencyPreview.insights_delta.ready_count >= 0 ? '+' : ''}
                      {dependencyPreview.insights_delta.ready_count} · Blocked{' '}
                      {dependencyPreview.insights_delta.blocked_count >= 0 ? '+' : ''}
                      {dependencyPreview.insights_delta.blocked_count} · Critical path{' '}
                      {dependencyPreview.insights_delta.critical_path_minutes == null
                        ? 'unchanged'
                        : `${dependencyPreview.insights_delta.critical_path_minutes >= 0 ? '+' : ''}${dependencyPreview.insights_delta.critical_path_minutes}m`}
                    </p>
                  )}
                  <small>{dependencyPreview.affected_task_ids.length} affected tasks</small>
                  <div>
                    <button
                      type="button"
                      className="cc-btn cc-btn--primary"
                      disabled={createDependency.isPending}
                      onClick={() => void handleDependencyConfirm()}
                    >
                      {createDependency.isPending ? 'Connecting…' : 'Connect'}
                    </button>
                    <button
                      type="button"
                      className="cc-btn cc-btn--ghost"
                      disabled={createDependency.isPending}
                      onClick={() => setDependencyPreview(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              )}
              <button
                type="button"
                className="cc-btn cc-btn--secondary"
                onClick={() => navigate(`/tasks/${selectedTask.id}`)}
              >
                Open details
              </button>
              {selectedTask.project_id && (
                <button
                  type="button"
                  className="cc-btn cc-btn--ghost"
                  disabled={placeMutation.isPending}
                  onClick={() => void handlePlacement(selectedTask.id, null, null)}
                >
                  Return to Inbox
                </button>
              )}
              {isMobile && (
                <details className="cc-inbox-triage__mobile-tree">
                  <summary>Move to project tree</summary>
                  <InboxTriageTree
                    projects={projects}
                    todos={todos}
                    selectedTaskId={selectedTaskId}
                    batchTaskIds={batchTaskIds}
                    telemetryByTaskId={executionTelemetryByTaskId}
                    disabled={
                      placementRevision == null ||
                      placeMutation.isPending ||
                      placeBatchMutation.isPending ||
                      previewDependency.isPending ||
                      createDependency.isPending
                    }
                    onSelectTask={setSelectedTaskId}
                    onPlace={handlePlacement}
                    onPlaceBatch={handleBatchPlacement}
                    onPreviewDependency={handleDependencyPreview}
                  />
                </details>
              )}
            </>
          ) : (
            <p>Select or drag an Inbox card to organize it.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
