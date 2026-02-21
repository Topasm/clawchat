import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../config/theme';
import { formatDate, formatTime } from '../utils/formatters';

export default function ActionCard({ type, payload, onAction }) {
  if (type === 'todo_created') {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Ionicons name="checkmark-circle" size={20} color={theme.colors.completedGreen} />
          <Text style={styles.headerText}>Task Created</Text>
        </View>
        <Text style={styles.title}>{payload.title}</Text>
        <View style={styles.metaRow}>
          {payload.priority && payload.priority !== 'medium' && (
            <Text style={styles.metaTag}>{payload.priority}</Text>
          )}
          {payload.due_date && (
            <Text style={styles.metaTag}>{formatDate(payload.due_date)}</Text>
          )}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => onAction?.('edit', payload)}
          >
            <Text style={styles.actionText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => onAction?.('complete', payload)}
          >
            <Text style={styles.actionText}>Complete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (type === 'event_created') {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Ionicons name="calendar" size={20} color={theme.colors.todayBlue} />
          <Text style={styles.headerText}>Event Created</Text>
        </View>
        <Text style={styles.title}>{payload.title}</Text>
        <View style={styles.metaRow}>
          {payload.start_time && (
            <Text style={styles.metaTag}>
              {formatDate(payload.start_time)} {formatTime(payload.start_time)}
            </Text>
          )}
          {payload.location && (
            <Text style={styles.metaTag}>{payload.location}</Text>
          )}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => onAction?.('edit', payload)}
          >
            <Text style={styles.actionText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonDanger]}
            onPress={() => onAction?.('delete', payload)}
          >
            <Text style={[styles.actionText, styles.actionTextDanger]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.actionCard,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
    minWidth: 220,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  headerText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.text,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  metaTag: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: theme.colors.primary,
  },
  actionButtonDanger: {
    backgroundColor: theme.colors.error,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFF',
  },
  actionTextDanger: {
    color: '#FFF',
  },
});
