import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { GiftedChat, Bubble, InputToolbar } from 'react-native-gifted-chat';
import { useTheme } from '../config/ThemeContext';
import apiClient from '../services/apiClient';
import { useChatStore } from '../stores/useChatStore';
import { useModuleStore } from '../stores/useModuleStore';
import { parseNaturalInput, shouldAutoCreate } from '../utils/naturalLanguageParser';
import ActionCard from '../components/ActionCard';
import QuickActionBar from '../components/QuickActionBar';

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
    actionData: msg.actionData || null,
  };
}

export default function ChatScreen({ route, navigation }) {
  const { colors, spacing } = useTheme();

  const conversationId = route.params?.id;
  const conversationTitle = route.params?.title || 'Chat';

  const messages = useChatStore((s) => s.messages);
  const setMessages = useChatStore((s) => s.setMessages);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [inputText, setInputText] = useState('');
  const addTodo = useModuleStore((s) => s.addTodo);
  const addEvent = useModuleStore((s) => s.addEvent);

  useEffect(() => {
    navigation.setOptions({ title: conversationTitle });
  }, [navigation, conversationTitle]);

  const fetchMessages = useCallback(async () => {
    try {
      const response = await apiClient.get(
        `/chat/conversations/${conversationId}/messages`
      );
      const items = response.data.items || [];
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
    return () => {
      useChatStore.getState().setMessages([]);
    };
  }, [fetchMessages]);

  const handleSmartSend = useCallback(
    async (text) => {
      if (shouldAutoCreate(text)) {
        const parsed = parseNaturalInput(text);
        try {
          if (parsed.type === 'event' || parsed.startTime) {
            const startTime = parsed.startTime || parsed.dueDate || new Date();
            const body = { title: parsed.title, start_time: startTime.toISOString() };
            const response = await apiClient.post('/events', body);
            addEvent(response.data);
            return { type: 'event_created', payload: response.data };
          } else {
            const body = { title: parsed.title, priority: parsed.priority || 'medium' };
            if (parsed.dueDate) body.due_date = parsed.dueDate.toISOString();
            const response = await apiClient.post('/todos', body);
            addTodo(response.data);
            return { type: 'todo_created', payload: response.data };
          }
        } catch {
          // Fall through to normal send
        }
      }
      return null;
    },
    [addTodo, addEvent]
  );

  const onSend = useCallback(
    async (newMessages = []) => {
      if (isSending) return;

      const userMessage = newMessages[0];
      useChatStore.getState().addMessage(userMessage);

      setIsSending(true);
      try {
        // Try smart creation first
        const actionResult = await handleSmartSend(userMessage.text);

        // Send through normal chat flow
        await apiClient.post('/chat/send', {
          conversation_id: conversationId,
          content: userMessage.text,
        });

        // If an action was created, inject an action card message
        if (actionResult) {
          const actionMsg = {
            _id: `action-${Date.now()}`,
            text: actionResult.type === 'todo_created'
              ? `Created task: "${actionResult.payload.title}"`
              : `Created event: "${actionResult.payload.title}"`,
            createdAt: new Date(),
            user: { _id: 'assistant', name: 'ClawChat' },
            actionData: actionResult,
          };
          useChatStore.getState().addMessage(actionMsg);
        }

        // Poll for AI response
        setTimeout(async () => {
          await fetchMessages();
          setIsSending(false);
        }, 1500);
      } catch (error) {
        setIsSending(false);
        Alert.alert('Error', 'Failed to send message.');
      }
    },
    [conversationId, fetchMessages, isSending, handleSmartSend]
  );

  const handleActionCardAction = useCallback(
    (action, payload) => {
      if (action === 'edit') {
        if (payload.start_time) {
          navigation.navigate('EventDetail', { eventId: payload.id });
        } else {
          navigation.navigate('TaskDetail', { todoId: payload.id });
        }
      } else if (action === 'complete') {
        useModuleStore.getState().toggleTodoComplete(payload.id);
      } else if (action === 'delete') {
        Alert.alert('Delete', `Delete "${payload.title}"?`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                if (payload.start_time) {
                  await apiClient.delete(`/events/${payload.id}`);
                  useModuleStore.getState().removeEvent(payload.id);
                } else {
                  await apiClient.delete(`/todos/${payload.id}`);
                  useModuleStore.getState().removeTodo(payload.id);
                }
              } catch {
                Alert.alert('Error', 'Failed to delete.');
              }
            },
          },
        ]);
      }
    },
    [navigation]
  );

  const handleQuickAction = useCallback((action) => {
    setInputText(action.prefix);
  }, []);

  const renderBubble = (props) => (
    <Bubble
      {...props}
      wrapperStyle={{
        left: { backgroundColor: colors.assistantBubble },
        right: { backgroundColor: colors.userBubble },
      }}
      textStyle={{
        left: { color: colors.text },
        right: { color: '#FFFFFF' },
      }}
    />
  );

  const renderCustomView = (props) => {
    const { currentMessage } = props;
    if (currentMessage?.actionData) {
      return (
        <ActionCard
          type={currentMessage.actionData.type}
          payload={currentMessage.actionData.payload}
          onAction={handleActionCardAction}
        />
      );
    }
    return null;
  };

  const renderInputToolbar = (props) => (
    <View>
      <QuickActionBar onSelectAction={handleQuickAction} />
      <InputToolbar
        {...props}
        containerStyle={{
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
        }}
        primaryStyle={styles.inputPrimary}
      />
    </View>
  );

  const renderFooter = () => {
    if (!isSending) return null;
    return (
      <View style={styles.footerContainer}>
        <ActivityIndicator size="small" color={colors.secondary} />
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GiftedChat
        messages={messages}
        onSend={(msgs) => onSend(msgs)}
        user={{ _id: 'user', name: 'You' }}
        renderBubble={renderBubble}
        renderCustomView={renderCustomView}
        renderInputToolbar={renderInputToolbar}
        renderFooter={renderFooter}
        text={inputText}
        onInputTextChanged={setInputText}
        placeholder="Type a message or task..."
        alwaysShowSend
        scrollToBottom
        scrollToBottomStyle={[styles.scrollToBottom, { backgroundColor: colors.primary }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputPrimary: {
    alignItems: 'center',
  },
  footerContainer: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  scrollToBottom: {},
});
