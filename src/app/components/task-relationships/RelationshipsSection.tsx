import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCreateTaskRelationship,
  useDeleteTaskRelationship,
  useTaskRelationshipsQuery,
  useTodosQuery,
} from '../../hooks/queries';
import { useToastStore } from '../../stores/useToastStore';
import { translateUi } from '../../i18n';
interface RelationshipsSectionProps {
  taskId: string;
}
interface ApiErrorResponse {
  response?: {
    status?: number;
    data?: {
      detail?: unknown;
      error?: {
        message?: unknown;
      };
    };
  };
}
function formatValidationDetail(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (!Array.isArray(detail)) return null;
  const messages = detail.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('msg' in item)) return [];
    return typeof item.msg === 'string' ? [item.msg] : [];
  });
  return messages.length > 0 ? messages.join('; ') : null;
}
export function getRelationshipMutationErrorMessage(error: unknown, fallback: string): string {
  const response = (error as ApiErrorResponse | null)?.response;
  if (response?.status !== 400 && response?.status !== 409 && response?.status !== 422) {
    return fallback;
  }
  const customMessage = response.data?.error?.message;
  if (typeof customMessage === 'string' && customMessage.trim()) return customMessage;
  return formatValidationDetail(response.data?.detail) ?? fallback;
}
export default function RelationshipsSection({ taskId }: RelationshipsSectionProps) {
  const navigate = useNavigate();
  const { data: todos = [] } = useTodosQuery();
  const { data: relationships = [], isLoading, isError } = useTaskRelationshipsQuery();
  const createRelationship = useCreateTaskRelationship();
  const deleteRelationship = useDeleteTaskRelationship();
  const addToast = useToastStore((state) => state.addToast);
  const [showForm, setShowForm] = useState(false);
  const [selectedTodoId, setSelectedTodoId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dependencies = useMemo(
    () =>
      relationships.filter(
        (relationship) =>
          relationship.type === 'depends_on' && relationship.source_task_id === taskId,
      ),
    [relationships, taskId],
  );
  const dependencyIds = useMemo(
    () => new Set(dependencies.map((relationship) => relationship.target_task_id)),
    [dependencies],
  );
  const todoTitleById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo.title])), [todos]);
  const handleAdd = async () => {
    if (!selectedTodoId || dependencyIds.has(selectedTodoId)) return;
    setErrorMessage(null);
    try {
      await createRelationship.mutateAsync({
        source_task_id: taskId,
        target_task_id: selectedTodoId,
        type: 'depends_on',
      });
      setShowForm(false);
      setSelectedTodoId('');
    } catch (error) {
      const message = getRelationshipMutationErrorMessage(error, 'Failed to add dependency');
      setErrorMessage(message);
      addToast('error', message);
    }
  };
  const handleRemove = async (relationshipId: string) => {
    setErrorMessage(null);
    try {
      await deleteRelationship.mutateAsync(relationshipId);
    } catch (error) {
      const message = getRelationshipMutationErrorMessage(error, 'Failed to remove dependency');
      setErrorMessage(message);
      addToast('error', message);
    }
  };
  const otherTodos = todos.filter((todo) => todo.id !== taskId && !dependencyIds.has(todo.id));
  const isMutating = createRelationship.isPending || deleteRelationship.isPending;
  return (
    <div className="cc-detail__section">
      <div className="cc-detail__section-title">{translateUi('Depends on')}</div>
      {isLoading && <div style={{ fontSize: 12 }}>{translateUi('Loading dependencies\u2026')}</div>}
      {isError && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--cc-error)' }}>
          {translateUi('\n          Failed to load dependencies\n        ')}
        </div>
      )}
      {dependencies.map((relationship) => (
        <div
          key={relationship.id}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
        >
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            style={{ fontSize: 13, color: 'var(--cc-primary)', padding: 0 }}
            onClick={() => navigate(`/tasks/${relationship.target_task_id}`)}
          >
            {todoTitleById.get(relationship.target_task_id) ?? relationship.target_task_id}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            style={{ padding: '2px 6px', fontSize: 11 }}
            onClick={() => void handleRemove(relationship.id)}
            disabled={isMutating}
          >
            {translateUi('\n            Remove\n          ')}
          </button>
        </div>
      ))}

      {errorMessage && (
        <div role="alert" style={{ marginTop: 6, fontSize: 12, color: 'var(--cc-error)' }}>
          {errorMessage}
        </div>
      )}

      {showForm ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <select
            className="cc-kanban-filter__select"
            value={selectedTodoId}
            onChange={(event) => setSelectedTodoId(event.target.value)}
            disabled={isMutating}
          >
            <option value="">{translateUi('Select task...')}</option>
            {otherTodos.map((todo) => (
              <option key={todo.id} value={todo.id}>
                {todo.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            onClick={() => void handleAdd()}
            disabled={!selectedTodoId || isMutating}
          >
            {translateUi('\n            Add\n          ')}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => {
              setShowForm(false);
              setErrorMessage(null);
            }}
            disabled={isMutating}
          >
            {translateUi('\n            Cancel\n          ')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="cc-btn cc-btn--ghost"
          style={{ fontSize: 12, marginTop: 4 }}
          onClick={() => {
            setShowForm(true);
            setErrorMessage(null);
          }}
          disabled={isLoading || isError}
        >
          {translateUi('\n          + Add dependency\n        ')}
        </button>
      )}
    </div>
  );
}
