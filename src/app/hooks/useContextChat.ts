import { useCallback } from 'react';
import { create } from 'zustand';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useGetOrCreateProjectConversation } from './queries';
import type { ChatPanelState } from './useChatPanel';
import { useToastStore } from '../stores/useToastStore';
import { translateUi } from '../i18n';
import type { TodoResponse } from '../types/api';
import { returnToState } from '../services/returnTo';

interface ChatContextState {
  /** What the open screen talks about, when it knows better than its route. */
  openHere: (() => void) | null;
  setOpenHere: (openHere: (() => void) | null) => void;
}

/** A screen (the project page) registers how to open its own conversation. */
export const useChatContextStore = create<ChatContextState>()((set) => ({
  openHere: null,
  setOpenHere: (openHere) => set({ openHere }),
}));

const TASK_PATH = /^\/tasks\/([^/]+)$/;

/**
 * Opens the one AI panel on a task's conversation, so a task's "talk about
 * this" lands in the same panel as ⌘K rather than in a page of its own.
 */
export function useOpenTaskChat(panel: ChatPanelState | null) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { mutateAsync: getOrCreate } = useGetOrCreateProjectConversation();
  return useCallback(
    async (taskId: string) => {
      const isCurrent = panel?.beginSelection() ?? (() => true);
      try {
        const conversation = await getOrCreate(taskId);
        if (!isCurrent()) return;
        // Outside the app shell there is no panel; the thread's own page will do.
        if (!panel) {
          navigate(`/chats/${conversation.id}`, {
            state: returnToState(location.pathname, location.search),
          });
          return;
        }
        const task = queryClient
          .getQueryData<TodoResponse[]>(queryKeys.todos)
          ?.find((todo) => todo.id === taskId);
        panel.open(conversation.id, {
          kind: 'task',
          title: 'Task Agent',
          subtitle: task?.title,
          projectId: task?.project_id ?? undefined,
        });
      } catch {
        useToastStore
          .getState()
          .addToast('error', translateUi('Could not open the agent conversation.'));
      }
    },
    [getOrCreate, location.pathname, location.search, navigate, panel, queryClient],
  );
}

/**
 * ⌘K and the top-right button: open the AI panel about whatever is on
 * screen -- the open task, the open project -- or close it when it is open.
 */
export function useToggleContextChat(panel: ChatPanelState) {
  const { pathname } = useLocation();
  const openTaskChat = useOpenTaskChat(panel);
  return useCallback(() => {
    if (panel.isOpen) {
      panel.close();
      return;
    }
    const openHere = useChatContextStore.getState().openHere;
    if (openHere) {
      openHere();
      return;
    }
    const taskId = TASK_PATH.exec(pathname)?.[1];
    if (taskId) void openTaskChat(taskId);
    else panel.open();
  }, [openTaskChat, panel, pathname]);
}
