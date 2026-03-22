import { useEffect, useMemo, useRef } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import type { ChatMessage } from '../../stores/useChatStore';
import MessageBubble from './MessageBubble';
import StreamingIndicator from './StreamingIndicator';

interface ChatPanelMessagesProps {
  conversationId: string | null;
  messages: ChatMessage[];
  onEditMessage?: (messageId: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onRegenerateMessage?: (messageId: string) => void;
}

export default function ChatPanelMessages({ conversationId, messages, onEditMessage, onDeleteMessage, onRegenerateMessage }: ChatPanelMessagesProps) {
  const isStreaming = useChatStore((s) => s.isStreaming);
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
          onDelete={onDeleteMessage ? () => onDeleteMessage(msg._id) : undefined}
          onRegenerate={
            msg.user._id === 'assistant' && onRegenerateMessage
              ? () => onRegenerateMessage(msg._id)
              : undefined
          }
          onEdit={msg.user._id === 'user' ? onEditMessage : undefined}
        />
      ))}
      {isStreaming && messages[0]?.text === '' && <StreamingIndicator />}
    </div>
  );
}
