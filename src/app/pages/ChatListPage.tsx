import { useState } from 'react';
import usePlatform from '../hooks/usePlatform';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../stores/useChatStore';
import ConversationItem from '../components/shared/ConversationItem';
import EmptyState from '../components/shared/EmptyState';
import { ChatBubbleIcon } from '../components/shared/Icons';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { ChatListSkeleton } from '../components/shared/PageSkeletons';

export default function ChatListPage() {
  const navigate = useNavigate();
  const conversations = useChatStore((s) => s.conversations);
  const conversationsLoaded = useChatStore((s) => s.conversationsLoaded);
  const createConversation = useChatStore((s) => s.createConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const { isMobile } = usePlatform();

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isMobile ? 12 : 16 }}>
        <div className="cc-page-header" style={{ marginBottom: 0 }}>
          <div className="cc-page-header__title">Chats</div>
          {!isMobile && <div className="cc-page-header__subtitle">Recent conversations</div>}
        </div>
        <button type="button" className="cc-btn cc-btn--primary" onClick={handleNewChat}>
          {isMobile ? '+ New' : '+ New Chat'}
        </button>
      </div>

      {loading && conversations.length === 0 && <ChatListSkeleton />}

      {!loading && conversations.length === 0 ? (
        <EmptyState icon={<ChatBubbleIcon size={20} />} message={isMobile ? 'Start chatting.' : 'No conversations yet. Start a new chat!'} />
      ) : conversations.length > 0 ? (
        <div style={{ height: isMobile ? 'calc(100vh - 140px)' : 'calc(100vh - 160px)', overflowY: 'auto' }}>
          {conversations.map((convo) => (
            <ConversationItem
              key={convo.id}
              conversation={convo}
              onClick={() => navigate(`/chats/${convo.id}`)}
              onDelete={() => setDeleteTarget(convo.id)}
            />
          ))}
        </div>
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
