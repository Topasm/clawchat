import { useCallback, useRef, useState } from 'react';
import { getChatWorkspaceScope, useChatStore } from '../stores/useChatStore';

export interface ChatPanelPresentation {
  kind: 'quick' | 'project' | 'task' | 'run';
  title: string;
  subtitle?: string;
}

export interface ChatPanelState {
  isOpen: boolean;
  conversationId: string | null;
  presentation: ChatPanelPresentation;
  toggle: () => void;
  open: (conversationId?: string, presentation?: ChatPanelPresentation) => void;
  close: () => void;
  setConversationId: (id: string | null) => void;
  setPresentation: (presentation: ChatPanelPresentation) => void;
  reset: () => void;
}

const QUICK_CHAT_PRESENTATION: ChatPanelPresentation = {
  kind: 'quick',
  title: 'Quick Chat',
};

export default function useChatPanel(): ChatPanelState {
  const [isOpen, setIsOpen] = useState(false);
  const [presentation, setPresentation] = useState<ChatPanelPresentation>(QUICK_CHAT_PRESENTATION);
  const [conversationId, setConversationIdState] = useState<string | null>(() => {
    const state = useChatStore.getState();
    return (
      state.activeConversationByWorkspace[getChatWorkspaceScope()] ??
      state.currentConversationId ??
      null
    );
  });
  const presentationRef = useRef(presentation);
  const quickConversationIdRef = useRef(conversationId);

  const storeConversationId = useCallback((id: string | null) => {
    setConversationIdState(id);
    useChatStore.getState().setCurrentConversationId(id);
  }, []);

  const setConversationId = useCallback(
    (id: string | null) => {
      if (presentationRef.current.kind === 'quick') quickConversationIdRef.current = id;
      storeConversationId(id);
    },
    [storeConversationId],
  );

  const updatePresentation = useCallback((nextPresentation: ChatPanelPresentation) => {
    presentationRef.current = nextPresentation;
    setPresentation(nextPresentation);
  }, []);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const open = useCallback(
    (id?: string, nextPresentation?: ChatPanelPresentation) => {
      setIsOpen(true);
      if (nextPresentation) updatePresentation(nextPresentation);
      const nextKind = nextPresentation?.kind ?? presentationRef.current.kind;
      if (id) {
        if (nextKind === 'quick') quickConversationIdRef.current = id;
        storeConversationId(id);
      }
    },
    [storeConversationId, updatePresentation],
  );
  const close = useCallback(() => setIsOpen(false), []);
  const reset = useCallback(() => {
    setIsOpen(false);
    updatePresentation(QUICK_CHAT_PRESENTATION);
    storeConversationId(quickConversationIdRef.current);
  }, [storeConversationId, updatePresentation]);

  return {
    isOpen,
    conversationId,
    presentation,
    toggle,
    open,
    close,
    setConversationId,
    setPresentation: updatePresentation,
    reset,
  };
}
