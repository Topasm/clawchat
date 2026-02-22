import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { useChatStore } from '../stores/useChatStore';
import ConversationItem from '../components/shared/ConversationItem';
import EmptyState from '../components/shared/EmptyState';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { ChatListSkeleton } from '../components/shared/PageSkeletons';

export default function ChatListPage() {
  const navigate = useNavigate();
  const conversations = useChatStore((s) => s.conversations);
  const conversationsLoaded = useChatStore((s) => s.conversationsLoaded);
  const createConversation = useChatStore((s) => s.createConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loading = !conversationsLoaded;

  const handleNewChat = async () => {
    try {
      const convo = await createConversation();
      navigate(`/chats/${convo.id}`);
    } catch {
      // Stay on list page
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await deleteConversation(deleteTarget);
    setDeleteTarget(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="cc-page-header" style={{ marginBottom: 0 }}>
          <div className="cc-page-header__title">Chats</div>
        </div>
        <button type="button" className="cc-btn cc-btn--primary" onClick={handleNewChat}>
          + New Chat
        </button>
      </div>

      {loading && conversations.length === 0 && <ChatListSkeleton />}

      {!loading && conversations.length === 0 ? (
        <EmptyState icon={'\uD83D\uDCAC'} message="No conversations yet. Start a new chat!" />
      ) : conversations.length > 0 ? (
        <Virtuoso
          style={{ height: 'calc(100vh - 160px)' }}
          data={conversations}
          increaseViewportBy={200}
          itemContent={(_index, convo) => (
            <ConversationItem
              key={convo.id}
              conversation={convo}
              onClick={() => navigate(`/chats/${convo.id}`)}
              onDelete={() => setDeleteTarget(convo.id)}
            />
          )}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Conversation"
        description="Are you sure you want to delete this conversation? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
