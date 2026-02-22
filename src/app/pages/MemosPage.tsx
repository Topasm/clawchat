import { useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useModuleStore } from '../stores/useModuleStore';
import { formatShortDateTime } from '../utils/formatters';
import Badge from '../components/shared/Badge';
import EmptyState from '../components/shared/EmptyState';
import RichTextEditor from '../components/shared/RichTextEditor';
import FileDropZone from '../components/shared/FileDropZone';
import AttachmentList from '../components/shared/AttachmentList';

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
  const [createEditorKey, setCreateEditorKey] = useState(0);

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
    setCreateEditorKey((k) => k + 1);
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
        <RichTextEditor
          key={`create-${createEditorKey}`}
          onChange={setNewContent}
          placeholder="Write a quick note... (rich text supported)"
          onSave={handleCreate}
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
        <Virtuoso
          style={{ height: 'calc(100vh - 280px)' }}
          data={filtered}
          increaseViewportBy={200}
          itemContent={(_index, memo) => (
            <div className="cc-memo-card" style={{ marginBottom: 8 }}>
              {editingId === memo.id ? (
                <div className="cc-memo-card__edit">
                  <RichTextEditor
                    key={`edit-${memo.id}`}
                    initialMarkdown={editContent}
                    onChange={setEditContent}
                    placeholder="Edit memo..."
                  />
                  <FileDropZone memoId={memo.id} />
                  <AttachmentList ownerId={memo.id} ownerType="memo" />
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
                  <RichTextEditor
                    key={`view-${memo.id}-${memo.updated_at}`}
                    initialMarkdown={memo.content}
                    editable={false}
                  />
                  <AttachmentList ownerId={memo.id} ownerType="memo" />
                  <div className="cc-memo-card__meta">
                    <span className="cc-memo-card__date">{formatShortDateTime(memo.updated_at)}</span>
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
          )}
        />
      )}
    </div>
  );
}
