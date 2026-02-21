import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import { useToastStore } from '../stores/useToastStore';
import TaskCard from '../components/shared/TaskCard';
import Badge from '../components/shared/Badge';
import SectionHeader from '../components/shared/SectionHeader';
import EmptyState from '../components/shared/EmptyState';
import QuickCaptureModal from '../components/shared/QuickCaptureModal';

export default function InboxPage() {
  const navigate = useNavigate();
  const todos = useModuleStore((s) => s.todos);
  const memos = useModuleStore((s) => s.memos);
  const addMemo = useModuleStore((s) => s.addMemo);
  const updateMemo = useModuleStore((s) => s.updateMemo);
  const removeMemo = useModuleStore((s) => s.removeMemo);

  const [error, setError] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);

  // Memo inline state
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    useModuleStore.getState().fetchTodos().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load');
    });
  }, []);

  const handleToggle = (id: string) => {
    useModuleStore.getState().toggleTodoComplete(id).catch(() => {});
  };

  const inboxTasks = Array.isArray(todos)
    ? todos.filter((t) => !t.due_date && t.status !== 'completed')
    : [];

  // Memo handlers
  const handleCreateMemo = () => {
    const content = newContent.trim();
    if (!content) return;
    const now = new Date().toISOString();
    addMemo({ id: `memo-${Date.now()}`, content, tags: [], created_at: now, updated_at: now });
    useToastStore.getState().addToast('success', 'Memo saved');
    setNewContent('');
  };

  const handleMemoKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCreateMemo();
  };

  const saveEdit = (id: string) => {
    if (!editContent.trim()) return;
    updateMemo(id, { content: editContent.trim(), updated_at: new Date().toISOString() });
    useToastStore.getState().addToast('success', 'Memo updated');
    setEditingId(null);
  };

  const handleDeleteMemo = (id: string) => {
    removeMemo(id);
    useToastStore.getState().addToast('success', 'Memo deleted');
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const totalItems = inboxTasks.length + memos.length;

  return (
    <div>
      <div className="cc-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="cc-page-header__title">Inbox</div>
          <div className="cc-page-header__subtitle">
            {totalItems > 0
              ? `${totalItems} item${totalItems !== 1 ? 's' : ''}`
              : 'Capture tasks and notes'}
          </div>
        </div>
        <button className="cc-btn cc-btn--primary" onClick={() => setShowCapture(true)}>
          + New
        </button>
      </div>
      <QuickCaptureModal isOpen={showCapture} onClose={() => setShowCapture(false)} />

      {error && (
        <div style={{ padding: '12px 16px', marginBottom: 12, borderRadius: 8, background: 'var(--cc-delete-bg)', color: 'var(--cc-error)', fontSize: 13 }}>
          Could not connect to server: {error}
        </div>
      )}

      {/* Unscheduled tasks */}
      {inboxTasks.length > 0 && (
        <SectionHeader title="Unscheduled Tasks" count={inboxTasks.length} variant="accent">
          {inboxTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => handleToggle(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
            />
          ))}
        </SectionHeader>
      )}

      {/* Memos section */}
      <SectionHeader title="Quick Notes" count={memos.length} variant="default">
        {/* Inline memo creation */}
        <div className="cc-memo-form">
          <textarea
            className="cc-memo-form__textarea"
            placeholder="Write a quick note... (Ctrl+Enter to save)"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={handleMemoKeyDown}
            rows={2}
          />
          <div className="cc-memo-form__footer">
            <span style={{ fontSize: 11, color: 'var(--cc-text-tertiary)' }}>
              Ctrl+Enter to save
            </span>
            <button
              className="cc-btn cc-btn--primary"
              onClick={handleCreateMemo}
              disabled={!newContent.trim()}
            >
              Save
            </button>
          </div>
        </div>

        {memos.length === 0 ? (
          <EmptyState icon="📝" message="No notes yet. Write one above!" />
        ) : (
          <div className="cc-memo-list">
            {memos.map((memo) => (
              <div key={memo.id} className="cc-memo-card">
                {editingId === memo.id ? (
                  <div className="cc-memo-card__edit">
                    <textarea
                      className="cc-memo-form__textarea"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      autoFocus
                    />
                    <div className="cc-memo-card__edit-actions">
                      <button className="cc-btn cc-btn--ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                      <button className="cc-btn cc-btn--primary" onClick={() => saveEdit(memo.id)}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="cc-memo-card__content">{memo.content}</div>
                    <div className="cc-memo-card__meta">
                      <span className="cc-memo-card__date">{formatDate(memo.updated_at)}</span>
                      {memo.tags?.map((tag) => (
                        <Badge key={tag} variant="tag">{tag}</Badge>
                      ))}
                      <div className="cc-memo-card__actions">
                        <button
                          className="cc-btn cc-btn--ghost"
                          onClick={() => { setEditingId(memo.id); setEditContent(memo.content); }}
                        >
                          Edit
                        </button>
                        <button
                          className="cc-btn cc-btn--ghost"
                          style={{ color: 'var(--cc-error)' }}
                          onClick={() => handleDeleteMemo(memo.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionHeader>

      {totalItems === 0 && (
        <EmptyState icon="🌟" message="Inbox Zero! Create a task or note to get started." />
      )}
    </div>
  );
}
