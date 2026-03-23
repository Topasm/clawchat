import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { useToastStore } from '../stores/useToastStore';
import usePlatform from '../hooks/usePlatform';
import { useTodosQuery, useToggleTodoComplete, useDeleteTodo } from '../hooks/queries';
import { queryKeys } from '../hooks/queries';
import TaskCard from '../components/shared/TaskCard';
import SectionHeader from '../components/shared/SectionHeader';
import EmptyState from '../components/shared/EmptyState';
import { InboxTrayIcon } from '../components/shared/Icons';
import apiClient from '../services/apiClient';
import type { TodoResponse } from '../types/schemas';

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
  const { isMobile } = usePlatform();
  const addToast = useToastStore((s) => s.addToast);
  const toggleMutation = useToggleTodoComplete();
  const deleteMutation = useDeleteTodo();

  const handleDelete = useCallback((id: string) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const handleToggle = useCallback((id: string) => {
    const todo = todos.find((t) => t.id === id);
    if (todo) toggleMutation.mutate({ id, currentStatus: todo.status });
  }, [todos, toggleMutation]);

  // Group by inbox_state
  const processing = todos.filter(
    (t) => t.inbox_state === 'classifying' || t.inbox_state === 'planning',
  );
  const questioning = todos.filter((t) => t.inbox_state === 'questioning');
  const planReady = todos.filter((t) => t.inbox_state === 'plan_ready');
  const errors = todos.filter((t) => t.inbox_state === 'error');
  const needsOrganising = todos.filter(
    (t) =>
      t.inbox_state === 'captured' ||
      ((!t.inbox_state || t.inbox_state === 'none') &&
        !t.due_date &&
        t.status !== 'completed' &&
        !t.parent_id),
  );

  const totalItems = processing.length + questioning.length + planReady.length + needsOrganising.length + errors.length;

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

      {/* Planning now (classifying/planning) */}
      {processing.length > 0 && (
        <SectionHeader title="Planning now" count={processing.length} variant="default" defaultOpen>
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
        <SectionHeader title="Answer questions" count={questioning.length} variant="accent" defaultOpen>
          {questioning.map((task) => (
            <QuestionnaireCard key={task.id} task={task} />
          ))}
        </SectionHeader>
      )}

      {/* Review suggestion (plan_ready) */}
      {planReady.length > 0 && (
        <SectionHeader title="Review suggestion" count={planReady.length} variant="accent" defaultOpen>
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
            const children = todos.filter((t) => t.parent_id === task.id);
            return (
              <div key={task.id} className="cc-inbox-card">
                <TaskCard
                  task={task}
                  onToggle={() => handleToggle(task.id)}
                  onClick={() => navigate(`/tasks/${task.id}`)}
                  onDelete={() => handleDelete(task.id)}
                  subTaskCount={children.length}
                />
                <div className="cc-inbox-card__actions">
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
        <SectionHeader title="Failed" count={errors.length} variant="warning" defaultOpen={false}>
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
    </div>
  );
}
