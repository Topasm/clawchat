import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { GiftedChat, Bubble, InputToolbar } from 'react-native-gifted-chat';
import { theme } from '../config/theme';
import apiClient from '../services/apiClient';
import { useChatStore } from '../stores/useChatStore';

/**
 * Map a server message object to the GiftedChat message format.
 */
function mapToGiftedMessage(msg) {
  const isUser = msg.role === 'user';
  return {
    _id: msg.id,
    text: msg.content || '',
    createdAt: new Date(msg.created_at),
    user: {
      _id: isUser ? 'user' : 'assistant',
      name: isUser ? 'You' : 'ClawChat',
    },
  };
}

export default function ChatScreen({ route, navigation }) {
  const conversationId = route.params?.id;
  const conversationTitle = route.params?.title || 'Chat';

  const messages = useChatStore((s) => s.messages);
  const setMessages = useChatStore((s) => s.setMessages);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  // Set the navigation header title
  useEffect(() => {
    navigation.setOptions({ title: conversationTitle });
  }, [navigation, conversationTitle]);

  // Load messages on mount
  const fetchMessages = useCallback(async () => {
    try {
      const response = await apiClient.get(
        `/chat/conversations/${conversationId}/messages`
      );
      const items = response.data.items || [];
      // GiftedChat expects newest first
      const giftedMessages = items.map(mapToGiftedMessage).reverse();
      setMessages(giftedMessages);
    } catch (error) {
      if (error.response?.status !== 401) {
        Alert.alert('Error', 'Failed to load messages.');
      }
    }
  }, [conversationId, setMessages]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await fetchMessages();
      setIsLoading(false);
    };
    load();

    // Clean up messages when leaving screen
    return () => {
      useChatStore.getState().setMessages([]);
    };
  }, [fetchMessages]);

  // Handle sending a message
  const onSend = useCallback(
    async (newMessages = []) => {
      if (isSending) return;

      const userMessage = newMessages[0];
      // Optimistically add the user message
      useChatStore.getState().addMessage(userMessage);

      setIsSending(true);
      try {
        await apiClient.post('/chat/send', {
          conversation_id: conversationId,
          content: userMessage.text,
        });

        // Phase 1: simple poll for the AI response after sending
        // Wait briefly then re-fetch messages to get the AI reply
        setTimeout(async () => {
          await fetchMessages();
          setIsSending(false);
        }, 1500);
      } catch (error) {
        setIsSending(false);
        Alert.alert('Error', 'Failed to send message.');
      }
    },
    [conversationId, fetchMessages, isSending]
  );

  // Custom bubble styling
  const renderBubble = (props) => (
    <Bubble
      {...props}
      wrapperStyle={{
        left: {
          backgroundColor: theme.colors.assistantBubble,
        },
        right: {
          backgroundColor: theme.colors.userBubble,
        },
      }}
      textStyle={{
        left: {
          color: theme.colors.text,
        },
        right: {
          color: theme.colors.surface,
        },
      }}
    />
  );

  // Custom input toolbar styling
  const renderInputToolbar = (props) => (
    <InputToolbar
      {...props}
      containerStyle={styles.inputToolbar}
      primaryStyle={styles.inputPrimary}
    />
  );

  // Loading footer while AI is processing
  const renderFooter = () => {
    if (!isSending) return null;
    return (
      <View style={styles.footerContainer}>
        <ActivityIndicator size="small" color={theme.colors.secondary} />
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GiftedChat
        messages={messages}
        onSend={(msgs) => onSend(msgs)}
        user={{ _id: 'user', name: 'You' }}
        renderBubble={renderBubble}
        renderInputToolbar={renderInputToolbar}
        renderFooter={renderFooter}
        placeholder="Type a message..."
        alwaysShowSend
        scrollToBottom
        scrollToBottomStyle={styles.scrollToBottom}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  inputToolbar: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  inputPrimary: {
    alignItems: 'center',
  },
  footerContainer: {
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
  },
  scrollToBottom: {
    backgroundColor: theme.colors.primary,
  },
});
