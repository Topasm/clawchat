import { useState } from 'react';
import { useModuleStore } from '../stores/useModuleStore';
import Badge from '../components/shared/Badge';
import EmptyState from '../components/shared/EmptyState';

export default function MemosPage() {
  const memos = useModuleStore((s) => s.memos);
  const createMemo = useModuleStore((s) => s.createMemo);
  const serverUpdateMemo = useModuleStore((s) => s.serverUpdateMemo);
  const deleteMemo = useModuleStore((s) => s.deleteMemo);

  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const handleCreate = async () => {
    const content = newContent.trim();
    if (!content) return;
    const tags = newTags.trim() ? newTags.split(',').map((t) => t.trim()).filter(Boolean) : [];
    try {
      await createMemo({ content, tags });
    } catch {
      // handled in store
    }
    setNewContent('');
    setNewTags('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleCreate();
    }
  };

  const startEdit = (id: string, content: string) => {
    setEditingId(id);
    setEditContent(content);
  };

  const saveEdit = async (id: string) => {
    if (!editContent.trim()) return;
    await serverUpdateMemo(id, { content: editContent.trim() });
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteMemo(id);
  };

  const filtered = searchQuery.trim()
    ? memos.filter(
        (m) =>
          m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    : memos;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div>
      <div className="cc-page-header">
        <div className="cc-page-header__title">Memos</div>
        <div className="cc-page-header__subtitle">
          {memos.length} memo{memos.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* New memo form */}
      <div className="cc-memo-form">
        <textarea
          className="cc-memo-form__textarea"
          placeholder="Write a quick note... (Ctrl+Enter to save)"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
        <div className="cc-memo-form__footer">
          <input
            className="cc-memo-form__tags-input"
            type="text"
            placeholder="Tags (comma-separated)"
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
          />
          <button
            className="cc-btn cc-btn--primary"
            onClick={handleCreate}
            disabled={!newContent.trim()}
          >
            Save Memo
          </button>
        </div>
      </div>

      {/* Search */}
      {memos.length > 0 && (
        <input
          className="cc-memo-search"
          type="text"
          placeholder="Search memos..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      )}

      {/* Memo list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="📝"
          message={memos.length === 0 ? 'No memos yet. Write one above!' : 'No memos match your search.'}
        />
      ) : (
        <div className="cc-memo-list">
          {filtered.map((memo) => (
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
                        onClick={() => startEdit(memo.id, memo.content)}
                      >
                        Edit
                      </button>
                      <button
                        className="cc-btn cc-btn--ghost"
                        style={{ color: 'var(--cc-error)' }}
                        onClick={() => handleDelete(memo.id)}
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
    </div>
  );
}
