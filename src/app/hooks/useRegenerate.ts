import { useChatStore } from '../stores/useChatStore';
import { useRegenerateMessage } from './queries';

export function useRegenerate(conversationId: string | null | undefined) {
  const sendMessageStreaming = useChatStore((s) => s.sendMessageStreaming);
  const regenerateMutation = useRegenerateMessage();

  const handleRegenerate = async (msgId: string) => {
    if (!conversationId) return;
    const userText = await regenerateMutation.mutateAsync({ conversationId, assistantMessageId: msgId });
    if (userText) {
      sendMessageStreaming(conversationId, userText);
    }
  };

  return handleRegenerate;
}
