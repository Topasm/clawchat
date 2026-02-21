import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../config/ThemeContext';
import apiClient from '../services/apiClient';
import { useChatStore } from '../stores/useChatStore';
import ContactRow from '../components/ContactRow';
import Separator from '../components/Separator';
import { formatRelativeTime, truncate } from '../utils/formatters';

export default function ConversationListScreen({ navigation }) {
  const { colors, typography, spacing } = useTheme();

  const conversations = useChatStore((s) => s.conversations);
  const setConversations = useChatStore((s) => s.setConversations);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const fetchConversations = useCallback(async () => {
    try {
      const response = await apiClient.get('/chat/conversations');
      setConversations(response.data.items || []);
    } catch (error) {
      if (error.response?.status !== 401) {
        Alert.alert('Error', 'Failed to load conversations.');
      }
    }
  }, [setConversations]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await fetchConversations();
      setIsLoading(false);
    };
    load();
  }, [fetchConversations]);

  // Re-fetch when navigating back to this screen
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchConversations();
    });
    return unsubscribe;
  }, [navigation, fetchConversations]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchConversations();
    setIsRefreshing(false);
  };

  const handleNewChat = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const response = await apiClient.post('/chat/conversations');
      const newConversation = response.data;
      useChatStore.getState().addConversation(newConversation);
      navigation.navigate('ChatScreen', {
        id: newConversation.id,
        title: newConversation.title || 'New Chat',
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to create a new conversation.');
    } finally {
      setIsCreating(false);
    }
  };

  const handlePressConversation = (conversation) => {
    navigation.navigate('ChatScreen', {
      id: conversation.id,
      title: conversation.title || 'Chat',
    });
  };

  const renderItem = ({ item }) => (
    <ContactRow
      title={item.title || 'Untitled Chat'}
      subtitle={truncate(item.last_message_preview, 60)}
      timestamp={item.updated_at ? formatRelativeTime(item.updated_at) : ''}
      onPress={() => handlePressConversation(item)}
    />
  );

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons
          name="chatbubbles-outline"
          size={64}
          color={colors.disabled}
        />
        <Text style={[styles.emptyTitle, typography.h2, { color: colors.text }]}>
          No conversations yet
        </Text>
        <Text style={[styles.emptySubtitle, typography.body, { color: colors.textSecondary }]}>
          Tap the + button to start a new chat
        </Text>
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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={renderEmpty}
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          contentContainerStyle={
            conversations.length === 0 ? styles.emptyList : undefined
          }
        />

        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={handleNewChat}
          activeOpacity={0.8}
          disabled={isCreating}
        >
          {isCreating ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Ionicons name="add" size={28} color="#FFF" />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyList: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    marginTop: 16,
  },
  emptySubtitle: {
    marginTop: 8,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.27,
    shadowRadius: 4.65,
  },
});
