import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { logger } from '../../services/logger';
import type { ChatMessage } from '../../stores/useChatStore';
import { ConversationResponseSchema, MessageResponseSchema, ProjectTodoResponseSchema } from '../../types/schemas';
import type { ConversationResponse, ProjectTodoResponse } from '../../types/api';
import { queryKeys } from './queryKeys';

// ---------------------------------------------------------------------------
// Query hooks — data lives in TanStack Query cache
// ---------------------------------------------------------------------------

export function useProjectsQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const res = await apiClient.get('/todos/projects');
      const raw = res.data ?? [];
      return z.array(ProjectTodoResponseSchema).parse(raw);
    },
    enabled: !!serverUrl,
  });
}

export function useConversationsQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: async () => {
      const res = await apiClient.get('/chat/conversations');
      const raw = res.data?.items ?? res.data ?? [];
      return z.array(ConversationResponseSchema).parse(raw);
    },
    enabled: !!serverUrl,
  });
}

export function useMessagesQuery(conversationId: string | null) {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  return useQuery({
    queryKey: queryKeys.messages(conversationId ?? ''),
    queryFn: async () => {
      const res = await apiClient.get(`/chat/conversations/${conversationId}/messages`);
      const raw = res.data?.items ?? res.data ?? [];
      const validated = z.array(MessageResponseSchema).parse(raw);
      const msgs: ChatMessage[] = validated.map((m) => ({
        _id: m.id,
        text: m.content,
        createdAt: new Date(m.created_at),
        user: { _id: m.role, name: m.role === 'user' ? 'You' : 'ClawChat' },
      }));
      return msgs.reverse(); // newest-first
    },
    enabled: !!serverUrl && !!conversationId,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks — optimistic updates in query cache
// ---------------------------------------------------------------------------

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ title, projectTodoId }: { title?: string; projectTodoId?: string } = {}) => {
      const convoTitle = title || 'New Conversation';
      try {
        const payload: Record<string, string> = { title: convoTitle };
        if (projectTodoId) payload.project_todo_id = projectTodoId;
        const res = await apiClient.post('/chat/conversations', payload);
        return res.data as ConversationResponse;
      } catch (err) {
        logger.warn('Failed to create conversation on server:', err);
        const localConvo: ConversationResponse = {
          id: `local-conv-${Date.now()}`,
          title: convoTitle,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        useToastStore.getState().addToast('warning', 'Created locally, server sync failed');
        return localConvo;
      }
    },
    onSuccess: (convo) => {
      // Add to cache optimistically
      queryClient.setQueryData<ConversationResponse[]>(queryKeys.conversations, (old) =>
        [convo, ...(old ?? [])],
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/chat/conversations/${id}`);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations });
      const previous = queryClient.getQueryData<ConversationResponse[]>(queryKeys.conversations);
      queryClient.setQueryData<ConversationResponse[]>(queryKeys.conversations, (old) =>
        (old ?? []).filter((c) => c.id !== id),
      );
      useToastStore.getState().addToast('success', 'Conversation deleted');
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.conversations, context.previous);
      }
      useToastStore.getState().addToast('error', 'Failed to delete conversation on server');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useGetOrCreateProjectConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (todoId: string) => {
      const res = await apiClient.get(`/chat/conversations/by-project/${todoId}`);
      return res.data as ConversationResponse;
    },
    onSuccess: (convo) => {
      // Add to conversations cache if not already present
      queryClient.setQueryData<ConversationResponse[]>(queryKeys.conversations, (old) => {
        const existing = old ?? [];
        if (existing.some((c) => c.id === convo.id)) return existing;
        return [convo, ...existing];
      });
    },
  });
}

export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, messageId }: { conversationId: string; messageId: string }) => {
      await apiClient.delete(`/chat/conversations/${conversationId}/messages/${messageId}`);
    },
    onMutate: async ({ conversationId, messageId }) => {
      const queryKey = queryKeys.messages(conversationId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ChatMessage[]>(queryKey);
      queryClient.setQueryData<ChatMessage[]>(queryKey, (old) =>
        (old ?? []).filter((m) => m._id !== messageId),
      );
      return { previous, queryKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      useToastStore.getState().addToast('error', 'Failed to delete message on server');
    },
    onSettled: (_data, _err, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
    },
  });
}

export function useEditMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, messageId, newText }: { conversationId: string; messageId: string; newText: string }) => {
      await apiClient.put(`/chat/conversations/${conversationId}/messages/${messageId}`, { content: newText });
      return newText;
    },
    onMutate: async ({ conversationId, messageId, newText }) => {
      const queryKey = queryKeys.messages(conversationId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ChatMessage[]>(queryKey);

      queryClient.setQueryData<ChatMessage[]>(queryKey, (old) => {
        if (!old) return old;
        const msgs = [...old];
        const msgIndex = msgs.findIndex((m) => m._id === messageId);
        if (msgIndex === -1) return msgs;

        // Update the message text
        msgs[msgIndex] = { ...msgs[msgIndex], text: newText };

        // Remove subsequent assistant messages (they'll be regenerated)
        // Messages are newest-first, so assistant messages after the edited one
        // are at lower indices
        const assistantIdsToRemove: string[] = [];
        for (let i = msgIndex - 1; i >= 0; i--) {
          if (msgs[i].user?._id === 'assistant') {
            assistantIdsToRemove.push(msgs[i]._id);
          } else {
            break;
          }
        }

        // Delete those assistant messages from server too (fire-and-forget)
        for (const id of assistantIdsToRemove) {
          apiClient
            .delete(`/chat/conversations/${conversationId}/messages/${id}`)
            .catch((err) => logger.warn('Failed to delete old assistant message:', err));
        }

        return msgs.filter((m) => !assistantIdsToRemove.includes(m._id));
      });

      return { previous, queryKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
    },
    onSettled: (_data, _err, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
    },
  });
}

export function useRegenerateMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, assistantMessageId }: { conversationId: string; assistantMessageId: string }) => {
      const queryKey = queryKeys.messages(conversationId);
      const messages = queryClient.getQueryData<ChatMessage[]>(queryKey) ?? [];
      const assistantIndex = messages.findIndex((m) => m._id === assistantMessageId);
      if (assistantIndex === -1) return null;

      // Find the user message that precedes this assistant message
      // Messages are newest-first
      let userMessage: ChatMessage | null = null;
      for (let i = assistantIndex + 1; i < messages.length; i++) {
        if (messages[i].user?._id === 'user') {
          userMessage = messages[i];
          break;
        }
      }
      if (!userMessage) return null;

      // Remove the assistant message from cache
      queryClient.setQueryData<ChatMessage[]>(queryKey, (old) =>
        (old ?? []).filter((m) => m._id !== assistantMessageId),
      );

      // Delete from server (fire-and-forget)
      apiClient
        .delete(`/chat/conversations/${conversationId}/messages/${assistantMessageId}`)
        .catch((err) => logger.warn('Failed to delete assistant message on server:', err));

      return userMessage.text;
    },
  });
}

export function useUpdateConversationTitle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, title }: { conversationId: string; title: string }) => {
      // This is just a local cache update — title comes from the stream event
      queryClient.setQueryData<ConversationResponse[]>(queryKeys.conversations, (old) =>
        (old ?? []).map((c) => (c.id === conversationId ? { ...c, title } : c)),
      );
    },
  });
}

export function useFetchMessages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await apiClient.get(`/chat/conversations/${conversationId}/messages`);
      const rawMessages: Array<{
        id: string; content: string; role: string; created_at: string;
        intent?: string; metadata?: Record<string, unknown>;
      }> = res.data?.items ?? res.data ?? [];
      const msgs: ChatMessage[] = rawMessages.map((m) => ({
        _id: m.id,
        text: m.content,
        createdAt: new Date(m.created_at),
        user: { _id: m.role, name: m.role === 'user' ? 'You' : 'ClawChat' },
        ...(m.metadata ? { metadata: m.metadata } : {}),
      }));
      return msgs.reverse(); // newest-first
    },
    onSuccess: (data, conversationId) => {
      queryClient.setQueryData(queryKeys.messages(conversationId), data);
    },
  });
}
