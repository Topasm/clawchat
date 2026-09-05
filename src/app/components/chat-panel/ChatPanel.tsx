import { useCallback, useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getChatDraftKey, getChatWorkspaceScope, useChatStore } from '../../stores/useChatStore';
import type { ChatMessage } from '../../stores/useChatStore';
import {
  useMessagesQuery,
  useCreateConversation,
  useEditMessage,
  useDeleteMessage,
  useRegenerateMessage,
  useResumeAgentRun,
  useRunsAwaitingInputQuery,
} from '../../hooks/queries';
import ChatPanelMessages from './ChatPanelMessages';
import ChatInput from './ChatInput';
import { CloseIcon, ExternalLinkIcon, MinusIcon, SendIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
interface ChatPanelProps {
  isOpen: boolean;
  conversationId: string | null;
  onToggle: () => void;
  onSetConversationId: (id: string | null) => void;
  title?: string;
  subtitle?: string;
  /** "bottom" (default, mobile) renders with motion height animation; "side" renders as a full-height side panel */
  variant?: 'bottom' | 'side';
}
export default function ChatPanel({
  isOpen,
  conversationId,
  onToggle,
  onSetConversationId,
  title = 'Quick Chat',
  subtitle,
  variant = 'bottom',
}: ChatPanelProps) {
  const navigate = useNavigate();
  const isStreaming = useChatStore(
    (s) => s.isStreaming && s.streamingConversationId === conversationId,
  );
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const sendMessageStreaming = useChatStore((s) => s.sendMessageStreaming);
  const addStreamingMessage = useChatStore((s) => s.addStreamingMessage);
  const streamingMessages = useChatStore((s) => s.streamingMessages);
  const reconcileMessages = useChatStore((s) => s.reconcileMessages);
  const updateStreamingMessageId = useChatStore((s) => s.updateStreamingMessageId);
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId);
  const createConversationMutation = useCreateConversation();
  const editMessageMutation = useEditMessage();
  const deleteMessageMutation = useDeleteMessage();
  const regenerateMutation = useRegenerateMessage();
  const resumeMutation = useResumeAgentRun();
  const { data: runsAwaitingInput = [] } = useRunsAwaitingInputQuery();
  const {
    data: queryMessages = [],
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessagesQuery(conversationId);
  const workspaceScope = getChatWorkspaceScope();
  // Merge query messages with streaming messages
  const messages: ChatMessage[] = useMemo(() => {
    const queryIds = new Set(queryMessages.map((m) => m._id));
    const onlyStreaming = streamingMessages.filter(
      (m) =>
        m.conversationId === conversationId &&
        (!m.workspaceScope || m.workspaceScope === workspaceScope) &&
        !queryIds.has(m._id),
    );
    return [...onlyStreaming, ...queryMessages];
  }, [conversationId, queryMessages, streamingMessages, workspaceScope]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [dismissedAnswerRunId, setDismissedAnswerRunId] = useState<string | null>(null);
  const waitingRun = runsAwaitingInput.find((run) => run.conversation_id === conversationId);
  const answerRun = waitingRun?.id === dismissedAnswerRunId ? undefined : waitingRun;
  useEffect(() => {
    setCurrentConversationId(conversationId);
  }, [conversationId, setCurrentConversationId]);
  useEffect(() => {
    if (!conversationId || queryMessages.length === 0) return;
    reconcileMessages(conversationId, new Set(queryMessages.map((message) => message._id)));
  }, [conversationId, queryMessages, reconcileMessages]);
  const handleStartEdit = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m._id === messageId);
      if (msg) {
        setEditingMessageId(messageId);
        setEditingText(msg.text);
      }
    },
    [messages],
  );
  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);
  const handleSend = useCallback(
    async (text: string) => {
      // If in edit mode, call editMessage instead
      if (editingMessageId && conversationId) {
        await editMessageMutation.mutateAsync({
          conversationId,
          messageId: editingMessageId,
          newText: text,
        });
        setEditingMessageId(null);
        setEditingText('');
        return;
      }
      if (answerRun) {
        await resumeMutation.mutateAsync({ runId: answerRun.id, followUp: text });
        return;
      }
      let cid = conversationId;
      if (!cid) {
        // Create conversation on the server first
        const convo = await createConversationMutation.mutateAsync({ title: text.slice(0, 40) });
        cid = convo.id;
        onSetConversationId(cid);
        setCurrentConversationId(cid);
      }
      const optimisticMessageId = crypto.randomUUID();
      const idempotencyKey = crypto.randomUUID();
      addStreamingMessage({
        _id: optimisticMessageId,
        text,
        createdAt: new Date(),
        user: { _id: 'user', name: 'You' },
        conversationId: cid,
        deliveryStatus: 'pending',
        idempotencyKey,
        workspaceScope: getChatWorkspaceScope(),
      });
      try {
        await sendMessageStreaming(cid, text, { optimisticMessageId, idempotencyKey });
      } catch {
        // Error handled in store
      }
    },
    [
      conversationId,
      editingMessageId,
      onSetConversationId,
      createConversationMutation,
      addStreamingMessage,
      sendMessageStreaming,
      editMessageMutation,
      answerRun,
      resumeMutation,
      setCurrentConversationId,
    ],
  );
  const handlePopOut = () => {
    if (conversationId) {
      navigate(`/chats/${conversationId}`);
    } else {
      navigate('/chats');
    }
  };
  const openContent = (
    <>
      <div className="cc-chat-panel__header">
        <span className="cc-chat-panel__header-copy">
          <span className="cc-chat-panel__header-title">{translateUi(title)}</span>
          {subtitle && <small>{subtitle}</small>}
        </span>
        <button
          type="button"
          className="cc-chat-panel__header-btn"
          onClick={handlePopOut}
          title={translateUi('Open full view')}
          aria-label={translateUi('Open full chat view')}
        >
          <ExternalLinkIcon size={14} />
        </button>
        <button
          type="button"
          className="cc-chat-panel__header-btn"
          onClick={onToggle}
          title={variant === 'side' ? translateUi('Close') : translateUi('Minimize')}
          aria-label={
            variant === 'side'
              ? translateUi('Close agent panel')
              : translateUi('Minimize agent panel')
          }
        >
          {variant === 'side' ? <CloseIcon size={14} /> : <MinusIcon size={14} />}
        </button>
      </div>
      <ChatPanelMessages
        conversationId={conversationId}
        messages={messages}
        hasOlderMessages={hasNextPage}
        isLoadingOlderMessages={isFetchingNextPage}
        onLoadOlderMessages={() => void fetchNextPage()}
        onRetryMessage={(message) => {
          if (!conversationId || !message.idempotencyKey) return;
          updateStreamingMessageId(message._id, message._id, 'pending');
          void sendMessageStreaming(conversationId, message.text, {
            optimisticMessageId: message._id,
            idempotencyKey: message.idempotencyKey,
          });
        }}
        onEditMessage={handleStartEdit}
        onDeleteMessage={(messageId) =>
          conversationId && deleteMessageMutation.mutate({ conversationId, messageId })
        }
        onRegenerateMessage={async (messageId) => {
          if (!conversationId) return;
          const userText = await regenerateMutation.mutateAsync({
            conversationId,
            assistantMessageId: messageId,
          });
          if (userText) {
            try {
              await sendMessageStreaming(conversationId, userText);
            } catch {
              // handled in store
            }
          }
        }}
      />
      <ChatInput
        onSend={handleSend}
        isStreaming={isStreaming}
        onStop={stopGeneration}
        draftKey={getChatDraftKey(conversationId)}
        editingMessageId={editingMessageId}
        editingText={editingText}
        onCancelEdit={handleCancelEdit}
        modeLabel={
          answerRun
            ? translateUi('Answering the agent')
            : waitingRun
              ? translateUi('Planning only — this message will not resume the run')
              : undefined
        }
        onClearMode={
          waitingRun ? () => setDismissedAnswerRunId(answerRun ? waitingRun.id : null) : undefined
        }
      />
    </>
  );
  const closedContent = (
    <div className="cc-chat-input" onClick={onToggle} style={{ cursor: 'pointer' }}>
      <div
        className="cc-chat-input__textarea"
        style={{
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          color: 'var(--cc-text-tertiary)',
        }}
      >
        {translateUi('Ask ClawChat anything...')}
      </div>
      <button
        type="button"
        className="cc-chat-input__btn cc-chat-input__btn--send"
        disabled
        aria-label={translateUi('Send message')}
      >
        <SendIcon size={16} />
      </button>
    </div>
  );
  // Side variant: full-height panel, no motion animation
  if (variant === 'side') {
    return (
      <div className="cc-chat-panel cc-chat-panel--side">
        {isOpen ? openContent : closedContent}
      </div>
    );
  }
  // Bottom variant (default): motion-animated height
  return (
    <motion.div
      className={`cc-chat-panel${isOpen ? '' : ' cc-chat-panel--collapsed'}`}
      animate={{ height: isOpen ? 360 : 58 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
    >
      {isOpen ? openContent : closedContent}
    </motion.div>
  );
}
