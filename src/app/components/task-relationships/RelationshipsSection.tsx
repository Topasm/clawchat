import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTodosQuery, useUpdateTodo } from '../../hooks/queries';

interface RelationshipsSectionProps {
  taskId: string;
}

export default function RelationshipsSection({ taskId }: RelationshipsSectionProps) {
  const navigate = useNavigate();
  const { data: todos = [] } = useTodosQuery();
  const updateTodo = useUpdateTodo();

  const [showForm, setShowForm] = useState(false);
  const [selectedTodoId, setSelectedTodoId] = useState('');

  const task = todos.find((t) => t.id === taskId);
  const dependsOn = task?.depends_on ?? [];

  const getTodoTitle = (id: string) => todos.find((t) => t.id === id)?.title ?? id;

  const handleAdd = () => {
    if (!selectedTodoId || dependsOn.includes(selectedTodoId)) return;
    updateTodo.mutate({ id: taskId, data: { depends_on: [...dependsOn, selectedTodoId] } });
    setShowForm(false);
    setSelectedTodoId('');
  };

  const handleRemove = (depId: string) => {
    const updated = dependsOn.filter((id) => id !== depId);
    updateTodo.mutate({ id: taskId, data: { depends_on: updated.length ? updated : null } });
  };

  const otherTodos = todos.filter((t) => t.id !== taskId && !dependsOn.includes(t.id));

  return (
    <div className="cc-detail__section">
      <div className="cc-detail__section-title">Depends on</div>
      {dependsOn.map((depId) => (
        <div key={depId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <span
            style={{ fontSize: 13, color: 'var(--cc-primary)', cursor: 'pointer' }}
            onClick={() => navigate(`/tasks/${depId}`)}
          >
            {getTodoTitle(depId)}
          </span>
          <button
            className="cc-btn cc-btn--ghost"
            style={{ padding: '2px 6px', fontSize: 11 }}
            onClick={() => handleRemove(depId)}
          >
            Remove
          </button>
        </div>
      ))}

      {showForm ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <select
            className="cc-kanban-filter__select"
            value={selectedTodoId}
            onChange={(e) => setSelectedTodoId(e.target.value)}
          >
            <option value="">Select task...</option>
            {otherTodos.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <button className="cc-btn cc-btn--primary" onClick={handleAdd} disabled={!selectedTodoId}>
            Add
          </button>
          <button className="cc-btn cc-btn--ghost" onClick={() => setShowForm(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="cc-btn cc-btn--ghost"
          style={{ fontSize: 12, marginTop: 4 }}
          onClick={() => setShowForm(true)}
        >
          + Add dependency
        </button>
      )}
    </div>
  );
}
