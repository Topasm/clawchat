import {
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { logger } from '../../services/logger';
import type { ChatMessage } from '../../stores/useChatStore';
import {
  ConversationResponseSchema,
  MessageResponseSchema,
  ProjectOverviewResponseSchema,
  ProjectResponseSchema,
} from '../../types/schemas';
import type {
  ConversationResponse,
  ProjectCreate,
  ProjectResponse,
  ProjectUpdate,
} from '../../types/api';
import { queryKeys } from './queryKeys';
import { translateUi } from '../../i18n';
// ---------------------------------------------------------------------------
// Query hooks — data lives in TanStack Query cache
// ---------------------------------------------------------------------------
interface MessagePage {
  messages: ChatMessage[];
  page: number;
  total: number;
  limit: number;
}

type MessageHistory = InfiniteData<MessagePage, number>;

function flattenMessageHistory(history: MessageHistory | undefined): ChatMessage[] {
  return history?.pages.flatMap((page) => page.messages) ?? [];
}

function filterMessageHistory(
  history: MessageHistory | undefined,
  predicate: (message: ChatMessage) => boolean,
): MessageHistory | undefined {
  if (!history) return history;
  return {
    ...history,
    pages: history.pages.map((page) => ({
      ...page,
      messages: page.messages.filter(predicate),
    })),
  };
}

export function useProjectsQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const res = await apiClient.get('/projects');
      const raw = res.data ?? [];
      return z.array(ProjectResponseSchema).parse(raw);
    },
    enabled: !!serverUrl,
  });
}
export function useProjectQuery(projectId: string | undefined) {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.project(projectId ?? ''),
    queryFn: async () => {
      const response = await apiClient.get(`/projects/${projectId}`);
      return ProjectOverviewResponseSchema.parse(response.data);
    },
    enabled: !!serverUrl && !!projectId,
  });
}
export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (project: ProjectCreate) => {
      const response = await apiClient.post('/projects', project);
      return ProjectResponseSchema.parse(response.data);
    },
    onSuccess: (project) => {
      queryClient.setQueryData<ProjectResponse[]>(queryKeys.projects, (current) => [
        project,
        ...(current ?? []),
      ]);
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      useToastStore.getState().addToast('success', translateUi('Project created'));
    },
    onError: () => {
      useToastStore.getState().addToast('error', translateUi('Failed to create project'));
    },
  });
}
export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: ProjectUpdate) => {
      const response = await apiClient.patch(`/projects/${projectId}`, updates);
      return ProjectResponseSchema.parse(response.data);
    },
    onSuccess: (project) => {
      queryClient.setQueryData<ProjectResponse[]>(queryKeys.projects, (current) =>
        current?.map((item) => (item.id === project.id ? project : item)),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
      useToastStore.getState().addToast('success', translateUi('Project saved'));
    },
    onError: () => {
      useToastStore.getState().addToast('error', translateUi('Could not save project settings'));
    },
  });
}
export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      await apiClient.delete(`/projects/${projectId}`);
      return projectId;
    },
    onSuccess: (projectId) => {
      queryClient.setQueryData<ProjectResponse[]>(queryKeys.projects, (current) =>
        current?.filter((item) => item.id !== projectId),
      );
      queryClient.removeQueries({ queryKey: queryKeys.project(projectId) });
      // Its tasks are back in the Inbox; every task view moved.
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskGraphInsights });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      useToastStore
        .getState()
        .addToast('success', translateUi('Project deleted. Its tasks are back in the Inbox.'));
    },
    onError: () => {
      useToastStore.getState().addToast('error', translateUi('Could not delete project'));
    },
  });
}
export function useConversationsQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: async () => {
      const res = await apiClient.get('/chat/conversations', { params: { limit: 100 } });
      const raw = res.data?.items ?? res.data ?? [];
      return z.array(ConversationResponseSchema).parse(raw);
    },
    enabled: !!serverUrl,
  });
}
export function useMessagesQuery(conversationId: string | null) {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useInfiniteQuery({
    queryKey: queryKeys.messages(conversationId ?? ''),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const res = await apiClient.get(`/chat/conversations/${conversationId}/messages`, {
        params: { page: pageParam, limit: 50 },
      });
      const raw = res.data?.items ?? [];
      const validated = z.array(MessageResponseSchema).parse(raw);
      return {
        messages: validated.map((m): ChatMessage => ({
          _id: m.id,
          text: m.content,
          createdAt: new Date(m.created_at),
          user: { _id: m.role, name: m.role === 'user' ? 'You' : 'ClawChat' },
          conversationId: m.conversation_id,
          metadata: m.metadata ?? undefined,
        })),
        page: Number(res.data?.page ?? pageParam),
        total: Number(res.data?.total ?? validated.length),
        limit: Number(res.data?.limit ?? 50),
      };
    },
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined,
    select: (data) => data.pages.flatMap((page) => page.messages),
    enabled: !!serverUrl && !!conversationId,
  });
}
// ---------------------------------------------------------------------------
// Mutation hooks — optimistic updates in query cache
// ---------------------------------------------------------------------------
export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      title,
      projectTodoId,
    }: {
      title?: string;
      projectTodoId?: string;
    } = {}) => {
      const convoTitle = title || 'New Conversation';
      const payload: Record<string, string> = { title: convoTitle };
      if (projectTodoId) payload.project_todo_id = projectTodoId;
      const res = await apiClient.post('/chat/conversations', payload);
      return res.data as ConversationResponse;
    },
    onSuccess: (convo) => {
      // Add to cache optimistically
      queryClient.setQueryData<ConversationResponse[]>(queryKeys.conversations, (old) => [
        convo,
        ...(old ?? []),
      ]);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
    onError: () => {
      useToastStore
        .getState()
        .addToast(
          'error',
          translateUi('Could not create conversation. Your message was not sent.'),
        );
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
      useToastStore.getState().addToast('success', translateUi('Conversation deleted'));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.conversations, context.previous);
      }
      useToastStore
        .getState()
        .addToast('error', translateUi('Failed to delete conversation on server'));
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
    mutationFn: async ({
      conversationId,
      messageId,
    }: {
      conversationId: string;
      messageId: string;
    }) => {
      await apiClient.delete(`/chat/conversations/${conversationId}/messages/${messageId}`);
    },
    onMutate: async ({ conversationId, messageId }) => {
      const queryKey = queryKeys.messages(conversationId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<MessageHistory>(queryKey);
      queryClient.setQueryData<MessageHistory>(queryKey, (old) =>
        filterMessageHistory(old, (message) => message._id !== messageId),
      );
      return { previous, queryKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      useToastStore.getState().addToast('error', translateUi('Failed to delete message on server'));
    },
    onSettled: (_data, _err, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) });
    },
  });
}
export function useEditMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      conversationId,
      messageId,
      newText,
    }: {
      conversationId: string;
      messageId: string;
      newText: string;
    }) => {
      await apiClient.put(`/chat/conversations/${conversationId}/messages/${messageId}`, {
        content: newText,
      });
      return newText;
    },
    onMutate: async ({ conversationId, messageId, newText }) => {
      const queryKey = queryKeys.messages(conversationId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<MessageHistory>(queryKey);
      const messages = flattenMessageHistory(previous);
      const msgIndex = messages.findIndex((message) => message._id === messageId);
      const assistantIdsToRemove: string[] = [];
      if (msgIndex !== -1) {
        // Messages are newest-first, so assistant messages after the edited
        // user message are located immediately before it.
        for (let index = msgIndex - 1; index >= 0; index -= 1) {
          if (messages[index].user?._id !== 'assistant') break;
          assistantIdsToRemove.push(messages[index]._id);
        }
      }
      queryClient.setQueryData<MessageHistory>(queryKey, (old) => {
        if (!old) return old;
        const removed = new Set(assistantIdsToRemove);
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages
              .filter((message) => !removed.has(message._id))
              .map((message) =>
                message._id === messageId ? { ...message, text: newText } : message,
              ),
          })),
        };
      });
      // Delete those assistant messages from server too (fire-and-forget)
      for (const id of assistantIdsToRemove) {
        apiClient
          .delete(`/chat/conversations/${conversationId}/messages/${id}`)
          .catch((err) => logger.warn('Failed to delete old assistant message:', err));
      }
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
    mutationFn: async ({
      conversationId,
      assistantMessageId,
    }: {
      conversationId: string;
      assistantMessageId: string;
    }) => {
      const queryKey = queryKeys.messages(conversationId);
      const history = queryClient.getQueryData<MessageHistory>(queryKey);
      const messages = flattenMessageHistory(history);
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
      queryClient.setQueryData<MessageHistory>(queryKey, (old) =>
        filterMessageHistory(old, (message) => message._id !== assistantMessageId),
      );
      // Delete from server (fire-and-forget)
      apiClient
        .delete(`/chat/conversations/${conversationId}/messages/${assistantMessageId}`)
        .catch((err) => logger.warn('Failed to delete assistant message on server:', err));
      return userMessage.text;
    },
  });
}
