import { useEffect, useMemo, useRef } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import { useRegenerate } from '../../hooks/useRegenerate';
import MessageBubble from './MessageBubble';
import StreamingIndicator from './StreamingIndicator';

interface ChatPanelMessagesProps {
  conversationId: string | null;
  onEditMessage?: (messageId: string) => void;
}

export default function ChatPanelMessages({ conversationId, onEditMessage }: ChatPanelMessagesProps) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const handleRegenerate = useRegenerate(conversationId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chronological = useMemo(() => [...messages].reverse(), [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chronological, isStreaming]);

  return (
    <div className="cc-chat-panel__messages" ref={scrollRef}>
      {chronological.map((msg) => (
        <MessageBubble
          key={msg._id}
          message={msg}
          onDelete={conversationId ? () => deleteMessage(conversationId, msg._id) : undefined}
          onRegenerate={
            msg.user._id === 'assistant' && conversationId
              ? () => handleRegenerate(msg._id)
              : undefined
          }
          onEdit={msg.user._id === 'user' ? onEditMessage : undefined}
        />
      ))}
      {isStreaming && messages[0]?.text === '' && <StreamingIndicator />}
    </div>
  );
}
