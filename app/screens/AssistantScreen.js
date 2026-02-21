import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../config/theme';

const MODULE_SECTIONS = [
  {
    key: 'todos',
    title: 'Todos',
    icon: 'checkbox-outline',
    color: theme.colors.success,
    description: 'Track your tasks and to-do items',
  },
  {
    key: 'calendar',
    title: 'Calendar',
    icon: 'calendar-outline',
    color: theme.colors.primary,
    description: 'View and manage your schedule',
  },
  {
    key: 'memos',
    title: 'Memos',
    icon: 'document-text-outline',
    color: theme.colors.warning,
    description: 'Quick notes and saved information',
  },
];

export default function AssistantScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Assistant</Text>
          <Text style={styles.subtitle}>
            Your personal AI-powered modules
          </Text>
        </View>

        {MODULE_SECTIONS.map((section) => (
          <View key={section.key} style={styles.card}>
            <View style={styles.cardHeader}>
              <View
                style={[styles.iconCircle, { backgroundColor: section.color + '20' }]}
              >
                <Ionicons name={section.icon} size={28} color={section.color} />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{section.title}</Text>
                <Text style={styles.cardDescription}>{section.description}</Text>
              </View>
            </View>

            <View style={styles.comingSoonBadge}>
              <Ionicons
                name="hourglass-outline"
                size={14}
                color={theme.colors.textSecondary}
              />
              <Text style={styles.comingSoonText}>Coming soon</Text>
            </View>
          </View>
        ))}

        <View style={styles.infoBox}>
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={theme.colors.primary}
          />
          <Text style={styles.infoText}>
            These modules will be powered by your AI assistant. Chat with ClawChat
            to create todos, schedule events, and save memos.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: theme.spacing.md,
  },
  header: {
    marginBottom: theme.spacing.lg,
  },
  title: {
    ...theme.typography.h1,
    color: theme.colors.text,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing.md,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    ...theme.typography.h2,
    color: theme.colors.text,
  },
  cardDescription: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    fontSize: 14,
    marginTop: 2,
  },
  comingSoonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.sm + 4,
    paddingTop: theme.spacing.sm + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  comingSoonText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    marginLeft: theme.spacing.xs,
    fontSize: 13,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: theme.colors.primary + '10',
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  infoText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    fontSize: 13,
    flex: 1,
    marginLeft: theme.spacing.sm,
    lineHeight: 18,
  },
});
