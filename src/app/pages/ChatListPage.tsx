import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../stores/useChatStore';
import apiClient from '../services/apiClient';
import ConversationItem from '../components/shared/ConversationItem';
import EmptyState from '../components/shared/EmptyState';

export default function ChatListPage() {
  const navigate = useNavigate();
  const conversations = useChatStore((s) => s.conversations);

  useEffect(() => {
    apiClient
      .get('/chat/conversations')
      .then((res) => useChatStore.getState().setConversations(res.data.items || res.data))
      .catch(() => {});
  }, []);

  const handleNewChat = async () => {
    try {
      const res = await apiClient.post('/chat/conversations', { title: 'New Conversation' });
      const convo = res.data;
      useChatStore.getState().addConversation(convo);
      navigate(`/chats/${convo.id}`);
    } catch {
      navigate('/chats');
    }
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

      {conversations.length === 0 ? (
        <EmptyState icon={'\uD83D\uDCAC'} message="No conversations yet. Start a new chat!" />
      ) : (
        conversations.map((convo) => (
          <ConversationItem
            key={convo.id}
            conversation={convo}
            onClick={() => navigate(`/chats/${convo.id}`)}
          />
        ))
      )}
    </div>
  );
}
