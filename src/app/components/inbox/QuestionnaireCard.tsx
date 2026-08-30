import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../hooks/queries';
import apiClient from '../../services/apiClient';
import { useToastStore } from '../../stores/useToastStore';
import type { TodoResponse } from '../../types/api';
import { translateUi } from '../../i18n';
/** Collects the planner's clarification answers for one captured task. */
export default function QuestionnaireCard({ task }: { task: TodoResponse }) {
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
      addToast('info', translateUi('Planning with your answers...'));
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
    } catch {
      addToast('error', translateUi('Failed to submit answers'));
    } finally {
      setSubmitting(false);
    }
  };
  const handleSkip = async () => {
    setSubmitting(true);
    try {
      await apiClient.post(`/todos/${task.id}/skip-questions`);
      addToast('info', translateUi('Skipping questions, planning...'));
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
    } catch {
      addToast('error', translateUi('Failed to skip questions'));
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
              placeholder={translateUi('Your answer...')}
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
          {translateUi('\n          Submit Answers\n        ')}
        </button>
        <button
          className="cc-btn cc-btn--secondary"
          style={{ fontSize: 12 }}
          onClick={handleSkip}
          disabled={submitting}
        >
          {translateUi('\n          Skip\n        ')}
        </button>
      </div>
    </div>
  );
}
