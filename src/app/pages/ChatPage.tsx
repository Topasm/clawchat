import { useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useChatStore } from '../stores/useChatStore';
import {
  useMessagesQuery,
  useConversationsQuery,
  useProjectsQuery,
  useDeleteMessage,
  useRegenerateMessage,
  queryKeys,
} from '../hooks/queries';
import type { ChatMessage } from '../stores/useChatStore';
import MessageBubble from '../components/chat-panel/MessageBubble';
import StreamingIndicator from '../components/chat-panel/StreamingIndicator';
import ChatInput from '../components/chat-panel/ChatInput';
import { getProjectIcon } from '../utils/projectIcons';

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: queryMessages = [] } = useMessagesQuery(conversationId ?? null);
  const streamingMessages = useChatStore((s) => s.streamingMessages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId);
  const addStreamingMessage = useChatStore((s) => s.addStreamingMessage);
  const sendMessageStreaming = useChatStore((s) => s.sendMessageStreaming);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const clearStreamingMessages = useChatStore((s) => s.clearStreamingMessages);
  const deleteMessageMutation = useDeleteMessage();
  const regenerateMutation = useRegenerateMessage();

  const { data: conversations = [] } = useConversationsQuery();
  const { data: projects = [] } = useProjectsQuery();

  const convo = conversations.find((c) => c.id === conversationId);
  const projectTodo = convo?.project_todo_id
    ? projects.find((p) => p.id === convo.project_todo_id)
    : null;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Merge query messages with streaming messages
  // Streaming messages are newest-first, query messages are newest-first
  const messages: ChatMessage[] = useMemo(() => {
    const queryIds = new Set(queryMessages.map((m) => m._id));
    // Only include streaming messages not yet in query cache
    const onlyStreaming = streamingMessages.filter((m) => !queryIds.has(m._id));
    return [...onlyStreaming, ...queryMessages];
  }, [queryMessages, streamingMessages]);

  useEffect(() => {
    if (!conversationId) return;
    setCurrentConversationId(conversationId);
    clearStreamingMessages();

    return () => setCurrentConversationId(null);
  }, [conversationId, setCurrentConversationId, clearStreamingMessages]);

  // Clear streaming messages when streaming ends and refetch
  useEffect(() => {
    if (!isStreaming && streamingMessages.length > 0 && conversationId) {
      // Give a small delay for the server to persist, then refetch
      const timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
        clearStreamingMessages();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, streamingMessages.length, conversationId, queryClient, clearStreamingMessages]);

  const handleSend = useCallback(async (text: string) => {
    if (!conversationId) return;
    addStreamingMessage({
      _id: crypto.randomUUID(),
      text,
      createdAt: new Date(),
      user: { _id: 'user', name: 'You' },
    });
    try {
      await sendMessageStreaming(conversationId, text);
    } catch {
      // handled in store
    }
  }, [conversationId, addStreamingMessage, sendMessageStreaming]);

  const handleRegenerate = useCallback(async (assistantMessageId: string) => {
    if (!conversationId) return;
    const userText = await regenerateMutation.mutateAsync({ conversationId, assistantMessageId });
    if (userText) {
      try {
        await sendMessageStreaming(conversationId, userText);
      } catch {
        // handled in store
      }
    }
  }, [conversationId, regenerateMutation, sendMessageStreaming]);

  // Store has newest-first; Virtuoso needs oldest-first
  const chronological = useMemo(() => [...messages].reverse(), [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chronological, isStreaming]);

  return (
    <div className="cc-chat-page">
      <div className="cc-chat-page__header">
        <button type="button" className="cc-chat-page__back" onClick={() => navigate('/chats')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 2L4 8l6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {projectTodo && <span style={{ fontSize: 18, lineHeight: 1 }}>{getProjectIcon(projectTodo.id)}</span>}
        <span className="cc-chat-page__title">{convo?.title || 'Chat'}</span>
      </div>

      {projectTodo && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 16px',
          background: 'var(--cc-primary-light)',
          borderBottom: '1px solid var(--cc-border)',
          fontSize: 13,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{getProjectIcon(projectTodo.id)}</span>
          <span style={{ fontWeight: 500, color: 'var(--cc-text)' }}>{projectTodo.title}</span>
          {projectTodo.subtask_count != null && projectTodo.subtask_count > 0 && (
            <span style={{ color: 'var(--cc-text-tertiary)', marginLeft: 'auto' }}>
              {projectTodo.completed_subtask_count ?? 0}/{projectTodo.subtask_count} tasks done
            </span>
          )}
        </div>
      )}

      <div className="cc-chat-page__messages" ref={scrollRef}>
        {chronological.map((msg) => (
          <MessageBubble
            key={msg._id}
            message={msg}
            projectIcon={projectTodo ? getProjectIcon(projectTodo.id) : undefined}
            onDelete={() => conversationId && deleteMessageMutation.mutate({ conversationId, messageId: msg._id })}
            onRegenerate={
              msg.user._id === 'assistant'
                ? () => handleRegenerate(msg._id)
                : undefined
            }
          />
        ))}
        {isStreaming && messages[0]?.text === '' && <StreamingIndicator />}
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
