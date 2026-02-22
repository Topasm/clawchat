import { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
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

  // Store has newest-first; Virtuoso needs oldest-first
  const chronological = useMemo(() => [...messages].reverse(), [messages]);

  const Footer = useMemo(() => {
    if (!isStreaming || messages[0]?.text !== '') return null;
    return () => <StreamingIndicator />;
  }, [isStreaming, messages]);

  return (
    <Virtuoso
      className="cc-chat-panel__messages"
      data={chronological}
      initialTopMostItemIndex={Math.max(0, chronological.length - 1)}
      followOutput="smooth"
      increaseViewportBy={{ top: 200, bottom: 200 }}
      itemContent={(_index, msg) => (
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
      )}
      components={Footer ? { Footer } : undefined}
    />
  );
}
