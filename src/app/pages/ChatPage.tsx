import { useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useChatStore } from '../stores/useChatStore';
import apiClient from '../services/apiClient';
import MessageBubble from '../components/chat-panel/MessageBubble';
import StreamingIndicator from '../components/chat-panel/StreamingIndicator';
import ChatInput from '../components/chat-panel/ChatInput';

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setMessages = useChatStore((s) => s.setMessages);
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId);
  const addMessage = useChatStore((s) => s.addMessage);
  const sendMessageStreaming = useChatStore((s) => s.sendMessageStreaming);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const regenerateMessage = useChatStore((s) => s.regenerateMessage);
  const conversations = useChatStore((s) => s.conversations);

  const convo = conversations.find((c) => c.id === conversationId);

  useEffect(() => {
    if (!conversationId) return;
    setCurrentConversationId(conversationId);

    apiClient
      .get(`/chat/conversations/${conversationId}/messages`)
      .then((res) => {
        const msgs = (res.data.items || res.data).map((m: { id: string; content: string; role: string; created_at: string }) => ({
          _id: m.id,
          text: m.content,
          createdAt: new Date(m.created_at),
          user: { _id: m.role, name: m.role === 'user' ? 'You' : 'ClawChat' },
        }));
        setMessages(msgs.reverse());
      })
      .catch(() => {});

    return () => setCurrentConversationId(null);
  }, [conversationId, setCurrentConversationId, setMessages]);

  const handleSend = useCallback(async (text: string) => {
    if (!conversationId) return;
    addMessage({
      _id: `user-${Date.now()}`,
      text,
      createdAt: new Date(),
      user: { _id: 'user', name: 'You' },
    });
    try {
      await sendMessageStreaming(conversationId, text);
    } catch {
      // handled in store
    }
  }, [conversationId, addMessage, sendMessageStreaming]);

  const handleRegenerate = (msgId: string) => {
    if (!conversationId) return;
    const userText = regenerateMessage(conversationId, msgId);
    if (userText) {
      sendMessageStreaming(conversationId, userText);
    }
  };

  return (
    <div className="cc-chat-page">
      <div className="cc-chat-page__header">
        <button type="button" className="cc-chat-page__back" onClick={() => navigate('/chats')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 2L4 8l6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="cc-chat-page__title">{convo?.title || 'Chat'}</span>
      </div>

      <div className="cc-chat-page__messages">
        {isStreaming && messages[0]?.text === '' && <StreamingIndicator />}
        {messages.map((msg) => (
          <MessageBubble
            key={msg._id}
            message={msg}
            onDelete={() => conversationId && deleteMessage(conversationId, msg._id)}
            onRegenerate={
              msg.user._id === 'assistant'
                ? () => handleRegenerate(msg._id)
                : undefined
            }
          />
        ))}
      </div>

      <ChatInput
        onSend={handleSend}
        isStreaming={isStreaming}
        onStop={stopGeneration}
        placeholder="Type a message..."
      />
    </div>
  );
}
