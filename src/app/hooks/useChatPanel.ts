import { useState, useCallback } from 'react';

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
  const [conversationId, setConversationId] = useState<string | null>(null);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const open = useCallback((id?: string) => {
    setIsOpen(true);
    if (id) setConversationId(id);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  return { isOpen, conversationId, toggle, open, close, setConversationId };
}
