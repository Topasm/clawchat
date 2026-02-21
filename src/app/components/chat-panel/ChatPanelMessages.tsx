import { useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import MessageBubble from './MessageBubble';
import StreamingIndicator from './StreamingIndicator';

interface ChatPanelMessagesProps {
  conversationId: string | null;
}

export default function ChatPanelMessages({ conversationId }: ChatPanelMessagesProps) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const regenerateMessage = useChatStore((s) => s.regenerateMessage);
  const sendMessageStreaming = useChatStore((s) => s.sendMessageStreaming);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleRegenerate = (msgId: string) => {
    if (!conversationId) return;
    const userText = regenerateMessage(conversationId, msgId);
    if (userText) {
      sendMessageStreaming(conversationId, userText);
    }
  };

  return (
    <div className="cc-chat-panel__messages" ref={containerRef}>
      {isStreaming && messages[0]?.text === '' && <StreamingIndicator />}
      {messages.map((msg) => (
        <MessageBubble
          key={msg._id}
          message={msg}
          onDelete={conversationId ? () => deleteMessage(conversationId, msg._id) : undefined}
          onRegenerate={
            msg.user._id === 'assistant' && conversationId
              ? () => handleRegenerate(msg._id)
              : undefined
          }
        />
      ))}
    </div>
  );
}
