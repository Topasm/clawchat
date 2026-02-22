import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useChatStore } from '../../stores/useChatStore';
import ChatPanelMessages from './ChatPanelMessages';
import ChatInput from './ChatInput';

interface ChatPanelProps {
  isOpen: boolean;
  conversationId: string | null;
  onToggle: () => void;
  onSetConversationId: (id: string | null) => void;
}

export default function ChatPanel({ isOpen, conversationId, onToggle, onSetConversationId }: ChatPanelProps) {
  const navigate = useNavigate();
  const isStreaming = useChatStore((s) => s.isStreaming);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const sendMessageStreaming = useChatStore((s) => s.sendMessageStreaming);
  const addMessage = useChatStore((s) => s.addMessage);
  const addConversation = useChatStore((s) => s.addConversation);
  const editMessage = useChatStore((s) => s.editMessage);
  const messages = useChatStore((s) => s.messages);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const handleStartEdit = useCallback((messageId: string) => {
    const msg = messages.find((m) => m._id === messageId);
    if (msg) {
      setEditingMessageId(messageId);
      setEditingText(msg.text);
    }
  }, [messages]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const handleSend = useCallback(async (text: string) => {
    // If in edit mode, call editMessage instead
    if (editingMessageId && conversationId) {
      await editMessage(conversationId, editingMessageId, text);
      setEditingMessageId(null);
      setEditingText('');
      return;
    }

    let cid = conversationId;
    if (!cid) {
      // Create a new conversation stub
      const newId = `panel-${Date.now()}`;
      cid = newId;
      onSetConversationId(newId);
      addConversation({ id: newId, title: text.slice(0, 40), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }

    addMessage({
      _id: `user-${Date.now()}`,
      text,
      createdAt: new Date(),
      user: { _id: 'user', name: 'You' },
    });

    try {
      await sendMessageStreaming(cid, text);
    } catch {
      // Error handled in store
    }
  }, [conversationId, editingMessageId, onSetConversationId, addConversation, addMessage, sendMessageStreaming, editMessage]);

  const handlePopOut = () => {
    if (conversationId) {
      navigate(`/chats/${conversationId}`);
    } else {
      navigate('/chats');
    }
  };

  return (
    <motion.div
      className="cc-chat-panel"
      animate={{ height: isOpen ? 360 : 52 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
    >
      {isOpen ? (
        <>
          <div className="cc-chat-panel__header">
            <span className="cc-chat-panel__header-title">Quick Chat</span>
            <button type="button" className="cc-chat-panel__header-btn" onClick={handlePopOut} title="Open full view">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 1h5v5M13 1L7 7M6 2H2.5A1.5 1.5 0 001 3.5v8A1.5 1.5 0 002.5 13h8a1.5 1.5 0 001.5-1.5V8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="cc-chat-panel__header-btn" onClick={onToggle} title="Minimize">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 7h8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <ChatPanelMessages conversationId={conversationId} onEditMessage={handleStartEdit} />
          <ChatInput
            onSend={handleSend}
            isStreaming={isStreaming}
            onStop={stopGeneration}
            editingMessageId={editingMessageId}
            editingText={editingText}
            onCancelEdit={handleCancelEdit}
          />
        </>
      ) : (
        <div
          className="cc-chat-input"
          onClick={onToggle}
          style={{ cursor: 'pointer' }}
        >
          <div
            className="cc-chat-input__textarea"
            style={{ pointerEvents: 'none', display: 'flex', alignItems: 'center', color: 'var(--cc-text-tertiary)' }}
          >
            Ask ClawChat anything...
          </div>
          <button type="button" className="cc-chat-input__btn cc-chat-input__btn--send" disabled>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14 2L7 9M14 2L9.5 14L7 9M14 2L2 6.5L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </motion.div>
  );
}
