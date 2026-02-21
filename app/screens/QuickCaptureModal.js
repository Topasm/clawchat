import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../config/ThemeContext';
import apiClient from '../services/apiClient';
import { useModuleStore } from '../stores/useModuleStore';

const TYPE_OPTIONS = [
  { key: 'task', label: 'Task', icon: 'checkbox-outline' },
  { key: 'event', label: 'Event', icon: 'calendar-outline' },
  { key: 'note', label: 'Note', icon: 'document-text-outline' },
];

function parseNaturalInput(text) {
  const result = { title: text.trim(), type: 'task', dueDate: null, startTime: null, priority: null };
  let cleanTitle = text.trim();

  // Date detection
  const now = new Date();
  const todayMatch = cleanTitle.match(/\b(today)\b/i);
  const tomorrowMatch = cleanTitle.match(/\b(tomorrow)\b/i);
  const nextMondayMatch = cleanTitle.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  const inDaysMatch = cleanTitle.match(/\bin\s+(\d+)\s+days?\b/i);

  if (todayMatch) {
    result.dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    cleanTitle = cleanTitle.replace(todayMatch[0], '').trim();
  } else if (tomorrowMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    result.dueDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    cleanTitle = cleanTitle.replace(tomorrowMatch[0], '').trim();
  } else if (nextMondayMatch) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = dayNames.indexOf(nextMondayMatch[1].toLowerCase());
    const d = new Date(now);
    const diff = (targetDay - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    result.dueDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    cleanTitle = cleanTitle.replace(nextMondayMatch[0], '').trim();
  } else if (inDaysMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + parseInt(inDaysMatch[1], 10));
    result.dueDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    cleanTitle = cleanTitle.replace(inDaysMatch[0], '').trim();
  }

  // Time detection
  const timeMatch = cleanTitle.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3]?.toLowerCase();
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    const base = result.dueDate || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    result.startTime = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes);
    if (!result.dueDate) result.dueDate = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    cleanTitle = cleanTitle.replace(timeMatch[0], '').trim();
  }

  // Type detection
  const eventKeywords = /\b(meeting|call|appointment|lunch|dinner|interview|conference)\b/i;
  const noteKeywords = /\b(note|remember that|fyi)\b/i;
  if (eventKeywords.test(cleanTitle)) {
    result.type = 'event';
  } else if (noteKeywords.test(cleanTitle)) {
    result.type = 'note';
  }

  // Priority detection
  if (/\b(urgent|asap)\b/i.test(cleanTitle)) {
    result.priority = 'urgent';
    cleanTitle = cleanTitle.replace(/\b(urgent|asap)\b/i, '').trim();
  } else if (/\b(important|high priority)\b/i.test(cleanTitle)) {
    result.priority = 'high';
    cleanTitle = cleanTitle.replace(/\b(important|high priority)\b/i, '').trim();
  } else if (/\b(low priority)\b/i.test(cleanTitle)) {
    result.priority = 'low';
    cleanTitle = cleanTitle.replace(/\b(low priority)\b/i, '').trim();
  }

  // Clean up extra spaces
  result.title = cleanTitle.replace(/\s+/g, ' ').trim();
  return result;
}

export default function QuickCaptureModal({ navigation }) {
  const { colors } = useTheme();

  const [text, setText] = useState('');
  const [selectedType, setSelectedType] = useState('task');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);
  const addTodo = useModuleStore((s) => s.addTodo);
  const addEvent = useModuleStore((s) => s.addEvent);
  const addMemo = useModuleStore((s) => s.addMemo);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Auto-detect type as user types
  useEffect(() => {
    if (!text.trim()) return;
    const parsed = parseNaturalInput(text);
    setSelectedType(parsed.type);
  }, [text]);

  const handleSubmit = async () => {
    if (!text.trim() || isSubmitting) return;
    setIsSubmitting(true);

    const parsed = parseNaturalInput(text);
    const type = selectedType; // user may have overridden

    try {
      if (type === 'task') {
        const body = { title: parsed.title, priority: parsed.priority || 'medium' };
        if (parsed.dueDate) body.due_date = parsed.dueDate.toISOString();
        const response = await apiClient.post('/todos', body);
        addTodo(response.data);
      } else if (type === 'event') {
        const startTime = parsed.startTime || parsed.dueDate || new Date();
        const body = { title: parsed.title, start_time: startTime.toISOString() };
        const response = await apiClient.post('/events', body);
        addEvent(response.data);
      } else {
        const body = { title: parsed.title, content: parsed.title };
        const response = await apiClient.post('/memos', body);
        addMemo(response.data);
      }
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', 'Failed to create item. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Quick Capture</Text>
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!text.trim() || isSubmitting}
        >
          <Text
            style={[
              styles.saveButton,
              { color: colors.primary },
              (!text.trim() || isSubmitting) && { color: colors.disabled },
            ]}
          >
            Save
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        ref={inputRef}
        style={[styles.input, { color: colors.text }]}
        placeholder='Try "buy milk tomorrow" or "meeting at 3pm"'
        placeholderTextColor={colors.disabled}
        value={text}
        onChangeText={setText}
        multiline
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        blurOnSubmit
      />

      <View style={[styles.typeRow, { borderTopColor: colors.border }]}>
        {TYPE_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[
              styles.typePill,
              { backgroundColor: colors.background },
              selectedType === opt.key && { backgroundColor: colors.primary },
            ]}
            onPress={() => setSelectedType(opt.key)}
          >
            <Ionicons
              name={opt.icon}
              size={16}
              color={selectedType === opt.key ? '#FFF' : colors.textSecondary}
            />
            <Text
              style={[
                styles.typePillText,
                { color: colors.textSecondary },
                selectedType === opt.key && { color: '#FFF' },
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  saveButton: {
    fontSize: 17,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    fontSize: 18,
    padding: 16,
    textAlignVertical: 'top',
  },
  typeRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  typePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  typePillText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
