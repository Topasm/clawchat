import { createContext, useContext, type ReactNode } from 'react';
import type { ChatPanelState } from '../../hooks/useChatPanel';

const ChatPanelControllerContext = createContext<ChatPanelState | null>(null);

export function ChatPanelControllerProvider({
  controller,
  children,
}: {
  controller: ChatPanelState;
  children: ReactNode;
}) {
  return (
    <ChatPanelControllerContext.Provider value={controller}>
      {children}
    </ChatPanelControllerContext.Provider>
  );
}

export function useChatPanelController(): ChatPanelState {
  const controller = useContext(ChatPanelControllerContext);
  if (!controller) throw new Error('useChatPanelController must be used inside Layout');
  return controller;
}

export function useOptionalChatPanelController(): ChatPanelState | null {
  return useContext(ChatPanelControllerContext);
}
