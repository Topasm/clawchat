import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Text,
} from 'react-native';
import { GiftedChat, Bubble, InputToolbar } from 'react-native-gifted-chat';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../config/ThemeContext';
import apiClient from '../services/apiClient';
import { useChatStore } from '../stores/useChatStore';
import { useModuleStore } from '../stores/useModuleStore';
import { parseNaturalInput, shouldAutoCreate } from '../utils/naturalLanguageParser';
import ActionCard from '../components/ActionCard';
import QuickActionBar from '../components/QuickActionBar';
import MarkdownBubble from '../components/MarkdownBubble';
import TypingIndicator from '../components/TypingIndicator';
import MessageBubbleWrapper from '../components/MessageBubbleWrapper';
import MessageActionMenu from '../components/MessageActionMenu';
import CopyFeedback from '../components/CopyFeedback';

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
  const { colors } = useTheme();
  const conversationId = route.params?.id;
  const conversationTitle = route.params?.title || 'Chat';

  const messages = useChatStore((s) => s.messages);
  const setMessages = useChatStore((s) => s.setMessages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessageStreaming = useChatStore((s) => s.sendMessageStreaming);
  const stopGeneration = useChatStore((s) => s.stopGeneration);

  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [inputText, setInputText] = useState('');
  const addTodo = useModuleStore((s) => s.addTodo);
  const addEvent = useModuleStore((s) => s.addEvent);

  // Streaming: typing indicator before first token
  const [waitingForFirstToken, setWaitingForFirstToken] = useState(false);
  const prevStreamingRef = useRef(false);

  // Message interaction state
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);

  useEffect(() => {
    navigation.setOptions({ title: conversationTitle });
  }, [navigation, conversationTitle]);

  // Track streaming state for typing indicator
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      setWaitingForFirstToken(true);
    }
    if (!isStreaming && prevStreamingRef.current) {
      setWaitingForFirstToken(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (waitingForFirstToken && messages.length > 0) {
      const lastMsg = messages[0];
      if (lastMsg.user?._id === 'assistant' && lastMsg.text) {
        setWaitingForFirstToken(false);
      }
    }
  }, [messages, waitingForFirstToken]);

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
      useChatStore.getState().stopGeneration();
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
      if (isSending || isStreaming) return;

      const userMessage = newMessages[0];

      // If editing, store already updated the message
      if (!editingMessageId) {
        useChatStore.getState().addMessage(userMessage);
      }
      setEditingMessageId(null);

      setIsSending(true);
      try {
        const actionResult = await handleSmartSend(userMessage.text);

        if (actionResult) {
          const actionMsg = {
            _id: `action-${Date.now()}`,
            text:
              actionResult.type === 'todo_created'
                ? `Created task: "${actionResult.payload.title}"`
                : `Created event: "${actionResult.payload.title}"`,
            createdAt: new Date(),
            user: { _id: 'assistant', name: 'ClawChat' },
            actionData: actionResult,
          };
          useChatStore.getState().addMessage(actionMsg);
        }

        // Try streaming first, fall back to echo
        try {
          await sendMessageStreaming(conversationId, userMessage.text);
        } catch {
          try {
            await apiClient.post('/chat/send', {
              conversation_id: conversationId,
              content: userMessage.text,
            });
            setTimeout(async () => {
              await fetchMessages();
            }, 1500);
          } catch {
            Alert.alert('Error', 'Failed to send message.');
          }
        }

        setIsSending(false);
      } catch {
        setIsSending(false);
        Alert.alert('Error', 'Failed to send message.');
      }
    },
    [conversationId, fetchMessages, isSending, isStreaming, handleSmartSend, sendMessageStreaming, editingMessageId]
  );

  // ---------------------------------------------------------------------------
  // Message interaction handlers
  // ---------------------------------------------------------------------------

  const handleMessageLongPress = useCallback((message) => {
    if (message?.actionData) return;
    setSelectedMessage(message);
    setShowActionMenu(true);
  }, []);

  const handleCloseActionMenu = useCallback(() => {
    setShowActionMenu(false);
    setSelectedMessage(null);
  }, []);

  const handleCopyMessage = useCallback(async (message) => {
    if (message?.text) {
      try {
        await Clipboard.setStringAsync(message.text);
        setShowCopyFeedback(true);
      } catch { /* silently fail */ }
    }
  }, []);

  const handleRegenerateMessage = useCallback(
    (message) => {
      const userText = useChatStore.getState().regenerateMessage(conversationId, message._id);
      if (userText) {
        // Re-send through streaming
        setIsSending(true);
        sendMessageStreaming(conversationId, userText)
          .catch(() => {
            // Fallback to echo
            return apiClient.post('/chat/send', { conversation_id: conversationId, content: userText })
              .then(() => setTimeout(() => fetchMessages(), 1500));
          })
          .finally(() => setIsSending(false));
      }
    },
    [conversationId, fetchMessages, sendMessageStreaming]
  );

  const handleEditMessage = useCallback((message) => {
    if (message?.text) {
      setEditingMessageId(message._id);
      setInputText(message.text);
    }
  }, []);

  const handleDeleteMessage = useCallback(
    (message) => {
      useChatStore.getState().deleteMessage(conversationId, message._id);
    },
    [conversationId]
  );

  const handleDismissCopyFeedback = useCallback(() => {
    setShowCopyFeedback(false);
  }, []);

  // Edit mode send handler
  const handleSend = useCallback(
    (newMessages = []) => {
      if (editingMessageId && newMessages.length > 0) {
        const newText = newMessages[0].text;
        useChatStore.getState().editMessage(conversationId, editingMessageId, newText)
          .then((editedText) => {
            if (editedText) {
              setEditingMessageId(null);
              setIsSending(true);
              sendMessageStreaming(conversationId, editedText)
                .catch(() => {
                  return apiClient.post('/chat/send', { conversation_id: conversationId, content: editedText })
                    .then(() => setTimeout(() => fetchMessages(), 1500));
                })
                .finally(() => setIsSending(false));
            }
          });
      } else {
        onSend(newMessages);
      }
    },
    [editingMessageId, conversationId, fetchMessages, onSend, sendMessageStreaming]
  );

  // ---------------------------------------------------------------------------
  // Action card handlers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderMessageText = useCallback((props) => {
    const { currentMessage, position } = props;
    const isUser = position === 'right';
    if (currentMessage?.actionData) return null;
    return (
      <MarkdownBubble
        text={currentMessage?.text || ''}
        isUser={isUser}
        style={{ paddingHorizontal: 8, paddingVertical: 4 }}
      />
    );
  }, []);

  const renderBubble = useCallback(
    (props) => (
      <MessageBubbleWrapper
        {...props}
        onLongPress={handleMessageLongPress}
        selectedMessageId={selectedMessage?._id}
        renderMessageText={renderMessageText}
      />
    ),
    [handleMessageLongPress, selectedMessage, renderMessageText]
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
        containerStyle={[
          { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
          isStreaming && { opacity: 0.5 },
          editingMessageId && { borderTopColor: colors.primary, borderTopWidth: 2 },
        ]}
        primaryStyle={{ alignItems: 'center' }}
      />
    </View>
  );

  const renderFooter = () => {
    if (waitingForFirstToken) {
      return (
        <View style={{ paddingVertical: 8, alignItems: 'center' }}>
          <TypingIndicator />
        </View>
      );
    }
    if (isStreaming) {
      return (
        <View style={{ paddingVertical: 8, alignItems: 'center' }}>
          <TouchableOpacity
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 9999,
              paddingHorizontal: 16,
              paddingVertical: 8,
              gap: 6,
            }}
            onPress={stopGeneration}
            activeOpacity={0.7}
          >
            <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: colors.textSecondary }} />
            <Text style={{ fontSize: 13, fontWeight: '500', color: colors.textSecondary }}>Stop generating</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (isSending) {
      return (
        <View style={{ paddingVertical: 8, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.secondary} />
        </View>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <GiftedChat
        messages={messages}
        onSend={(msgs) => handleSend(msgs)}
        user={{ _id: 'user', name: 'You' }}
        renderBubble={renderBubble}
        renderCustomView={renderCustomView}
        renderInputToolbar={renderInputToolbar}
        renderFooter={renderFooter}
        text={inputText}
        onInputTextChanged={setInputText}
        placeholder={editingMessageId ? 'Edit your message...' : 'Type a message or task...'}
        alwaysShowSend
        scrollToBottom
        scrollToBottomStyle={{ backgroundColor: colors.primary }}
        disableComposer={isStreaming}
      />

      <MessageActionMenu
        visible={showActionMenu}
        message={selectedMessage}
        onClose={handleCloseActionMenu}
        onCopy={handleCopyMessage}
        onRegenerate={handleRegenerateMessage}
        onEdit={handleEditMessage}
        onDelete={handleDeleteMessage}
      />

      <CopyFeedback
        visible={showCopyFeedback}
        onDismiss={handleDismissCopyFeedback}
      />
    </View>
  );
}
