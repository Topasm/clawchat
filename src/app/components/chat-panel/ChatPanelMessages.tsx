import { useEffect, useMemo, useRef } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import type { ChatMessage } from '../../stores/useChatStore';
import MessageBubble from './MessageBubble';
import StreamingIndicator from './StreamingIndicator';
import { translateUi } from '../../i18n';

interface ChatPanelMessagesProps {
  conversationId: string | null;
  messages: ChatMessage[];
  onEditMessage?: (messageId: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onRegenerateMessage?: (messageId: string) => void;
  hasOlderMessages?: boolean;
  isLoadingOlderMessages?: boolean;
  onLoadOlderMessages?: () => void;
  onRetryMessage?: (message: ChatMessage) => void;
}

export default function ChatPanelMessages({
  conversationId,
  messages,
  onEditMessage,
  onDeleteMessage,
  onRegenerateMessage,
  hasOlderMessages,
  isLoadingOlderMessages,
  onLoadOlderMessages,
  onRetryMessage,
}: ChatPanelMessagesProps) {
  const isStreaming = useChatStore(
    (s) => s.isStreaming && s.streamingConversationId === conversationId,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const newestMessageIdRef = useRef<string | undefined>(undefined);

  const chronological = useMemo(() => [...messages].reverse(), [messages]);
  const durableRunReferences = useMemo(() => {
    const runIds = new Set<string>();
    const taskIds = new Set<string>();
    for (const message of messages) {
      if (message.metadata?.action_type !== 'run_update') continue;
      if (typeof message.metadata.run_id === 'string') runIds.add(message.metadata.run_id);
      if (typeof message.metadata.agent_task_id === 'string') {
        taskIds.add(message.metadata.agent_task_id);
      }
    }
    return { runIds, taskIds };
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const newestMessageId = messages[0]?._id;
    if (
      isStreaming ||
      !newestMessageIdRef.current ||
      newestMessageIdRef.current !== newestMessageId
    ) {
      el.scrollTop = el.scrollHeight;
    }
    newestMessageIdRef.current = newestMessageId;
  }, [chronological, isStreaming, messages]);

  return (
    <div className="cc-chat-panel__messages" ref={scrollRef}>
      {hasOlderMessages && (
        <button
          type="button"
          className="cc-chat-history__load-older"
          disabled={isLoadingOlderMessages}
          onClick={onLoadOlderMessages}
        >
          {translateUi(
            isLoadingOlderMessages ? 'Loading earlier messages...' : 'Load earlier messages',
          )}
        </button>
      )}
      {chronological.map((msg) => (
        <MessageBubble
          key={msg._id}
          message={msg}
          onDelete={
            !msg.deliveryStatus && onDeleteMessage ? () => onDeleteMessage(msg._id) : undefined
          }
          onRegenerate={
            !msg.deliveryStatus && msg.user._id === 'assistant' && onRegenerateMessage
              ? () => onRegenerateMessage(msg._id)
              : undefined
          }
          onEdit={!msg.deliveryStatus && msg.user._id === 'user' ? onEditMessage : undefined}
          onRetry={msg.deliveryStatus === 'failed' ? () => onRetryMessage?.(msg) : undefined}
          suppressTaskProgress={
            msg.metadata?.action_type === 'task_delegated' &&
            ((typeof msg.metadata.run_id === 'string' &&
              durableRunReferences.runIds.has(msg.metadata.run_id)) ||
              (typeof msg.metadata.task_id === 'string' &&
                durableRunReferences.taskIds.has(msg.metadata.task_id)))
          }
        />
      ))}
      {isStreaming && messages[0]?.text === '' && <StreamingIndicator />}
    </div>
  );
}
