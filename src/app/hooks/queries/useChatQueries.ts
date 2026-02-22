import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useChatStore } from '../../stores/useChatStore';
import type { ChatMessage } from '../../stores/useChatStore';
import { ConversationResponseSchema, MessageResponseSchema } from '../../types/schemas';
import { queryKeys } from './queryKeys';

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

export function useConversationsQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const query = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: async () => {
      const res = await apiClient.get('/chat/conversations');
      const raw = res.data?.items ?? res.data ?? [];
      return z.array(ConversationResponseSchema).parse(raw);
    },
    enabled: !!serverUrl,
  });

  useEffect(() => {
    if (query.data) {
      useChatStore.getState().setConversations(query.data);
      useChatStore.setState({ conversationsLoaded: true });
    }
  }, [query.data]);

  return query;
}

export function useMessagesQuery(conversationId: string | null) {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const query = useQuery({
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
      return msgs.reverse();
    },
    enabled: !!serverUrl && !!conversationId,
  });

  useEffect(() => {
    if (query.data) {
      useChatStore.getState().setMessages(query.data);
    }
  }, [query.data]);

  return query;
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => useChatStore.getState().createConversation(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => useChatStore.getState().deleteConversation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}
