import { useChatStore } from '../stores/useChatStore';

export function useRegenerate(conversationId: string | null | undefined) {
  const regenerateMessage = useChatStore((s) => s.regenerateMessage);
  const sendMessageStreaming = useChatStore((s) => s.sendMessageStreaming);

  const handleRegenerate = (msgId: string) => {
    if (!conversationId) return;
    const userText = regenerateMessage(conversationId, msgId);
    if (userText) {
      sendMessageStreaming(conversationId, userText);
    }
  };

  return handleRegenerate;
}
