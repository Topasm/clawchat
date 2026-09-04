import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getChatDraftKey, getChatWorkspaceScope, useChatStore } from '../stores/useChatStore';
import {
  useMessagesQuery,
  useConversationsQuery,
  useProjectsQuery,
  useDeleteMessage,
  useRegenerateMessage,
  useResumeAgentRun,
  useRunsAwaitingInputQuery,
  useTodosQuery,
} from '../hooks/queries';
import type { ChatMessage } from '../stores/useChatStore';
import MessageBubble from '../components/chat-panel/MessageBubble';
import StreamingIndicator from '../components/chat-panel/StreamingIndicator';
import ChatInput from '../components/chat-panel/ChatInput';
import { getProjectIcon } from '../utils/projectIcons';
import { ChevronLeftIcon } from '../components/shared/Icons';
import { translateUi } from '../i18n';
export default function ChatPage() {
  const { conversationId } = useParams<{
    conversationId: string;
  }>();
  const navigate = useNavigate();
  const {
    data: queryMessages = [],
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessagesQuery(conversationId ?? null);
  const workspaceScope = getChatWorkspaceScope();
  const streamingMessages = useChatStore((s) => s.streamingMessages);
  const isStreaming = useChatStore(
    (s) => s.isStreaming && s.streamingConversationId === conversationId,
  );
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId);
  const addStreamingMessage = useChatStore((s) => s.addStreamingMessage);
  const sendMessageStreaming = useChatStore((s) => s.sendMessageStreaming);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const reconcileMessages = useChatStore((s) => s.reconcileMessages);
  const updateStreamingMessageId = useChatStore((s) => s.updateStreamingMessageId);
  const deleteMessageMutation = useDeleteMessage();
  const regenerateMutation = useRegenerateMessage();
  const resumeMutation = useResumeAgentRun();
  const { data: runsAwaitingInput = [] } = useRunsAwaitingInputQuery();
  const { data: conversations = [] } = useConversationsQuery();
  const { data: projects = [] } = useProjectsQuery();
  const convo = conversations.find((c) => c.id === conversationId);
  const projectTodo = projects.find(
    (project) =>
      project.id === convo?.project_id || project.root_task_id === convo?.project_todo_id,
  );
  // A thread scoped to a task rather than a project root: what the agent
  // creates here becomes steps of that task.
  const { data: todos = [] } = useTodosQuery();
  const scopedTask =
    !projectTodo && convo?.project_todo_id
      ? todos.find((todo) => todo.id === convo.project_todo_id)
      : undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const newestMessageIdRef = useRef<string | undefined>(undefined);
  const [dismissedAnswerRunId, setDismissedAnswerRunId] = useState<string | null>(null);
  const waitingRun = runsAwaitingInput.find((run) => run.conversation_id === conversationId);
  const answerRun = waitingRun?.id === dismissedAnswerRunId ? undefined : waitingRun;
  // Merge query messages with streaming messages
  // Streaming messages are newest-first, query messages are newest-first
  const messages: ChatMessage[] = useMemo(() => {
    const queryIds = new Set(queryMessages.map((m) => m._id));
    // Only include streaming messages not yet in query cache
    const onlyStreaming = streamingMessages.filter(
      (m) =>
        m.conversationId === conversationId &&
        (!m.workspaceScope || m.workspaceScope === workspaceScope) &&
        !queryIds.has(m._id),
    );
    return [...onlyStreaming, ...queryMessages];
  }, [conversationId, queryMessages, streamingMessages, workspaceScope]);
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
    if (!conversationId) return;
    setCurrentConversationId(conversationId);
  }, [conversationId, setCurrentConversationId]);
  useEffect(() => {
    if (!conversationId || queryMessages.length === 0) return;
    reconcileMessages(conversationId, new Set(queryMessages.map((message) => message._id)));
  }, [conversationId, queryMessages, reconcileMessages]);
  const handleSend = useCallback(
    async (text: string) => {
      if (!conversationId) return;
      if (answerRun) {
        await resumeMutation.mutateAsync({ runId: answerRun.id, followUp: text });
        return;
      }
      const optimisticMessageId = crypto.randomUUID();
      const idempotencyKey = crypto.randomUUID();
      addStreamingMessage({
        _id: optimisticMessageId,
        text,
        createdAt: new Date(),
        user: { _id: 'user', name: 'You' },
        conversationId,
        deliveryStatus: 'pending',
        idempotencyKey,
        workspaceScope: getChatWorkspaceScope(),
      });
      try {
        await sendMessageStreaming(conversationId, text, { optimisticMessageId, idempotencyKey });
      } catch {
        // handled in store
      }
    },
    [conversationId, addStreamingMessage, sendMessageStreaming, answerRun, resumeMutation],
  );
  const handleRegenerate = useCallback(
    async (assistantMessageId: string) => {
      if (!conversationId) return;
      const userText = await regenerateMutation.mutateAsync({ conversationId, assistantMessageId });
      if (userText) {
        try {
          await sendMessageStreaming(conversationId, userText);
        } catch {
          // handled in store
        }
      }
    },
    [conversationId, regenerateMutation, sendMessageStreaming],
  );
  // Store has newest-first; Virtuoso needs oldest-first
  const chronological = useMemo(() => [...messages].reverse(), [messages]);
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
    <div className="cc-chat-page">
      <div className="cc-chat-page__header">
        <button
          type="button"
          className="cc-chat-page__back"
          onClick={() => navigate('/chats')}
          aria-label={translateUi('Back to chats')}
        >
          <ChevronLeftIcon size={16} />
        </button>
        {projectTodo && (
          <span style={{ fontSize: 18, lineHeight: 1 }}>{getProjectIcon(projectTodo.id)}</span>
        )}
        <span className="cc-chat-page__title">{convo?.title || translateUi('Chat')}</span>
      </div>

      {projectTodo && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 16px',
            background: 'var(--cc-primary-light)',
            borderBottom: '1px solid var(--cc-border)',
            fontSize: 13,
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>{getProjectIcon(projectTodo.id)}</span>
          <span style={{ fontWeight: 500, color: 'var(--cc-text)' }}>{projectTodo.title}</span>
          {projectTodo.task_count > 0 && (
            <span style={{ color: 'var(--cc-text-tertiary)', marginLeft: 'auto' }}>
              {projectTodo.completed_task_count}/{projectTodo.task_count}
              {translateUi(' tasks done\n            ')}
            </span>
          )}
        </div>
      )}

      {scopedTask && (
        <div
          className="cc-chat-page__scope"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 16px',
            background: 'var(--cc-primary-light)',
            borderBottom: '1px solid var(--cc-border)',
            fontSize: 13,
          }}
        >
          <span style={{ color: 'var(--cc-text-tertiary)' }}>{translateUi('Task thread')}</span>
          <span style={{ fontWeight: 500, color: 'var(--cc-text)' }}>{scopedTask.title}</span>
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            style={{ marginLeft: 'auto' }}
            title={translateUi(
              'Steps live under this task; ask the agent to add, plan, or run them.',
            )}
            onClick={() => navigate(`/tasks/${scopedTask.id}`)}
          >
            {translateUi('Open task')}
          </button>
        </div>
      )}

      <div className="cc-chat-page__messages" ref={scrollRef}>
        {hasNextPage && (
          <button
            type="button"
            className="cc-chat-history__load-older"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {translateUi(
              isFetchingNextPage ? 'Loading earlier messages...' : 'Load earlier messages',
            )}
          </button>
        )}
        {chronological.map((msg) => (
          <MessageBubble
            key={msg._id}
            message={msg}
            projectIcon={projectTodo ? getProjectIcon(projectTodo.id) : undefined}
            onDelete={
              !msg.deliveryStatus
                ? () =>
                    conversationId &&
                    deleteMessageMutation.mutate({ conversationId, messageId: msg._id })
                : undefined
            }
            onRegenerate={
              !msg.deliveryStatus && msg.user._id === 'assistant'
                ? () => handleRegenerate(msg._id)
                : undefined
            }
            onRetry={
              msg.deliveryStatus === 'failed' && msg.idempotencyKey && conversationId
                ? () => {
                    updateStreamingMessageId(msg._id, msg._id, 'pending');
                    void sendMessageStreaming(conversationId, msg.text, {
                      optimisticMessageId: msg._id,
                      idempotencyKey: msg.idempotencyKey,
                    });
                  }
                : undefined
            }
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

      <ChatInput
        onSend={handleSend}
        isStreaming={isStreaming}
        onStop={stopGeneration}
        draftKey={getChatDraftKey(conversationId)}
        placeholder={translateUi('Type a message...')}
        modeLabel={answerRun ? translateUi('Answering the agent') : undefined}
        onClearMode={answerRun ? () => setDismissedAnswerRunId(answerRun.id) : undefined}
      />
    </div>
  );
}
