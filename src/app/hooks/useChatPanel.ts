import { useState, useCallback } from 'react';
import { getChatWorkspaceScope, useChatStore } from '../stores/useChatStore';

interface ChatPanelState {
  isOpen: boolean;
  conversationId: string | null;
  toggle: () => void;
  open: (conversationId?: string) => void;
  close: () => void;
  setConversationId: (id: string | null) => void;
}

export default function useChatPanel(): ChatPanelState {
  const [isOpen, setIsOpen] = useState(false);
  const [conversationId, setConversationIdState] = useState<string | null>(() => {
    const state = useChatStore.getState();
    return (
      state.activeConversationByWorkspace[getChatWorkspaceScope()] ??
      state.currentConversationId ??
      null
    );
  });

  const setConversationId = useCallback((id: string | null) => {
    setConversationIdState(id);
    useChatStore.getState().setCurrentConversationId(id);
  }, []);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const open = useCallback(
    (id?: string) => {
      setIsOpen(true);
      if (id) setConversationId(id);
    },
    [setConversationId],
  );
  const close = useCallback(() => setIsOpen(false), []);

  return { isOpen, conversationId, toggle, open, close, setConversationId };
}
