import { useState } from 'react';
import Badge from './Badge';

interface PlanSubtask {
  title: string;
  estimated_minutes?: number;
  due_date?: string;
  priority?: string;
}

interface PlanReviewDiffProps {
  plan: {
    summary?: string;
    subtasks?: PlanSubtask[];
    project_name?: string;
  };
  onApply: (selectedIndices?: number[]) => void;
  onDismiss: () => void;
  compact?: boolean;
}

export default function PlanReviewDiff({ plan, onApply, onDismiss, compact }: PlanReviewDiffProps) {
  const subtasks = plan.subtasks ?? [];
  const [selected, setSelected] = useState<Set<number>>(() => new Set(subtasks.map((_, i) => i)));

  const toggleIndex = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleApply = () => {
    if (selected.size === subtasks.length) {
      onApply();
    } else {
      onApply(Array.from(selected));
    }
  };

  return (
    <div className={`cc-plan-review${compact ? ' cc-plan-review--compact' : ''}`}>
      {plan.summary && (
        <p className="cc-plan-review__summary">{plan.summary}</p>
      )}

      <div className="cc-plan-review__stats">
        {subtasks.length > 0 && (
          <span className="cc-plan-review__stat">
            Will create {subtasks.length} sub-task{subtasks.length !== 1 ? 's' : ''}
          </span>
        )}
        {subtasks.some((s) => s.due_date) && (
          <span className="cc-plan-review__stat">
            Will assign dates
          </span>
        )}
        {plan.project_name && (
          <span className="cc-plan-review__stat">
            Will file under {plan.project_name}
          </span>
        )}
      </div>

      {subtasks.length > 0 && (
        <div className="cc-plan-review__subtasks">
          {subtasks.map((s, i) => (
            <label key={i} className="cc-plan-review__subtask">
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => toggleIndex(i)}
                className="cc-plan-review__checkbox"
              />
              <div className="cc-plan-review__subtask-body">
                <span className="cc-plan-review__subtask-title">{s.title}</span>
                <span className="cc-plan-review__subtask-meta">
                  {s.estimated_minutes && <span>{s.estimated_minutes}m</span>}
                  {s.due_date && <Badge variant="due" dueDate={s.due_date} />}
                </span>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="cc-plan-review__actions">
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          style={{ fontSize: 12 }}
          onClick={handleApply}
          disabled={selected.size === 0 && subtasks.length > 0}
        >
          Apply{selected.size < subtasks.length && subtasks.length > 0 ? ` (${selected.size}/${subtasks.length})` : ''}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--ghost"
          style={{ fontSize: 12 }}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
