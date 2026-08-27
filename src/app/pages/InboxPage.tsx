import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { useToastStore } from '../stores/useToastStore';
import usePlatform from '../hooks/usePlatform';
import {
  useDeleteTodo,
  usePlaceTodo,
  useProjectsQuery,
  useTaskGraphInsightsQuery,
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
import type { TodoResponse } from '../types/schemas';
import { isTerminalTaskStatus } from '../utils/taskStatus';
import InboxTriageTree, { INBOX_TASK_DRAG_TYPE } from '../components/inbox/InboxTriageTree';

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
  const { isMobile } = usePlatform();
  const addToast = useToastStore((s) => s.addToast);
  const toggleMutation = useToggleTodoComplete();
  const deleteMutation = useDeleteTodo();
  const placeMutation = usePlaceTodo();
  const undoPlacement = useUndoTodoPlacement();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [placementRevision, setPlacementRevision] = useState<number | null>(null);

  useEffect(() => {
    if (graphInsights.data) setPlacementRevision(graphInsights.data.graph_revision);
  }, [graphInsights.data]);

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
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const taskId = event.dataTransfer.getData(INBOX_TASK_DRAG_TYPE);
              if (taskId && !placeMutation.isPending) {
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
              {needsOrganising.map((task) => {
                return (
                  <div
                    key={task.id}
                    className={`cc-inbox-card${selectedTaskId === task.id ? ' cc-inbox-card--selected' : ''}`}
                    draggable={!placeMutation.isPending}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(INBOX_TASK_DRAG_TYPE, task.id);
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
            disabled={placementRevision == null || placeMutation.isPending}
            onSelectTask={setSelectedTaskId}
            onPlace={handlePlacement}
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
                    disabled={placementRevision == null || placeMutation.isPending}
                    onSelectTask={setSelectedTaskId}
                    onPlace={handlePlacement}
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
