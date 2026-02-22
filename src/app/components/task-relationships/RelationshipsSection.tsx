import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../../stores/useModuleStore';
import { useTaskRelationshipsQuery, useCreateTaskRelationship, useDeleteTaskRelationship } from '../../hooks/queries';
import { isDemoMode } from '../../utils/helpers';
import type { RelationshipType } from '../../types/api';

interface RelationshipsSectionProps {
  taskId: string;
}

const TYPE_LABELS: Record<string, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  related: 'Related to',
  duplicate_of: 'Duplicate of',
};

const RELATIONSHIP_TYPES: RelationshipType[] = ['blocks', 'blocked_by', 'related', 'duplicate_of'];

export default function RelationshipsSection({ taskId }: RelationshipsSectionProps) {
  const navigate = useNavigate();
  const todos = useModuleStore((s) => s.todos);
  const { data: relationships = [] } = useTaskRelationshipsQuery(taskId);
  const createRelationship = useCreateTaskRelationship();
  const deleteRelationship = useDeleteTaskRelationship();

  const [showForm, setShowForm] = useState(false);
  const [selectedTodoId, setSelectedTodoId] = useState('');
  const [selectedType, setSelectedType] = useState<RelationshipType>('related');

  // In demo mode, show empty section with disabled add
  if (isDemoMode() && relationships.length === 0) {
    return (
      <div className="cc-detail__section">
        <div className="cc-detail__section-title">Relationships</div>
        <div style={{ fontSize: 13, color: 'var(--cc-text-tertiary)', padding: '8px 0' }}>
          Connect to a server to manage task relationships.
        </div>
      </div>
    );
  }

  const grouped = {
    blocks: relationships.filter((r) => r.relationship_type === 'blocks' && r.source_todo_id === taskId),
    blocked_by: relationships.filter((r) => r.relationship_type === 'blocked_by' && r.source_todo_id === taskId),
    related: relationships.filter((r) => r.relationship_type === 'related'),
    duplicate_of: relationships.filter((r) => r.relationship_type === 'duplicate_of'),
  };

  const getLinkedId = (r: { source_todo_id: string; target_todo_id: string }) =>
    r.source_todo_id === taskId ? r.target_todo_id : r.source_todo_id;

  const getTodoTitle = (id: string) => todos.find((t) => t.id === id)?.title ?? id;

  const handleAdd = () => {
    if (!selectedTodoId) return;
    createRelationship.mutate({
      source_todo_id: taskId,
      target_todo_id: selectedTodoId,
      relationship_type: selectedType,
    });
    setShowForm(false);
    setSelectedTodoId('');
  };

  const otherTodos = todos.filter((t) => t.id !== taskId);

  return (
    <div className="cc-detail__section">
      <div className="cc-detail__section-title">Relationships</div>
      {Object.entries(grouped).map(([type, rels]) =>
        rels.length > 0 ? (
          <div key={type} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--cc-text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>
              {TYPE_LABELS[type]}
            </div>
            {rels.map((rel) => {
              const linkedId = getLinkedId(rel);
              return (
                <div key={rel.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span
                    style={{ fontSize: 13, color: 'var(--cc-primary)', cursor: 'pointer' }}
                    onClick={() => navigate(`/tasks/${linkedId}`)}
                  >
                    {getTodoTitle(linkedId)}
                  </span>
                  <button
                    className="cc-btn cc-btn--ghost"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => deleteRelationship.mutate({ id: rel.id, sourceTodoId: rel.source_todo_id, targetTodoId: rel.target_todo_id })}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        ) : null,
      )}

      {showForm ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <select
            className="cc-kanban-filter__select"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as RelationshipType)}
          >
            {RELATIONSHIP_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
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
          + Add relationship
        </button>
      )}
    </div>
  );
}
