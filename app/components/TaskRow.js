import React, { useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../config/theme';
import { formatDueDate, isOverdue } from '../utils/formatters';
import PriorityBadge from './PriorityBadge';

export default function TaskRow({ todo, onToggleComplete, onPress, onSwipeLeft, onSwipeRight }) {
  const swipeableRef = useRef(null);
  const isCompleted = todo.status === 'completed';
  const overdue = !isCompleted && isOverdue(todo.due_date);

  const renderLeftActions = (progress, dragX) => {
    if (!onSwipeRight) return null;
    const trans = dragX.interpolate({ inputRange: [0, 80], outputRange: [-20, 0], extrapolate: 'clamp' });
    return (
      <Animated.View style={[styles.swipeAction, styles.swipeRight, { transform: [{ translateX: trans }] }]}>
        <Ionicons name="today-outline" size={20} color="#FFF" />
        <Text style={styles.swipeText}>Today</Text>
      </Animated.View>
    );
  };

  const renderRightActions = (progress, dragX) => {
    if (!onSwipeLeft) return null;
    const trans = dragX.interpolate({ inputRange: [-80, 0], outputRange: [0, 20], extrapolate: 'clamp' });
    return (
      <Animated.View style={[styles.swipeAction, styles.swipeLeft, { transform: [{ translateX: trans }] }]}>
        <Ionicons name="trash-outline" size={20} color="#FFF" />
        <Text style={styles.swipeText}>Delete</Text>
      </Animated.View>
    );
  };

  const handleSwipeLeft = () => {
    swipeableRef.current?.close();
    onSwipeLeft?.(todo);
  };

  const handleSwipeRight = () => {
    swipeableRef.current?.close();
    onSwipeRight?.(todo);
  };

  const dueDateText = formatDueDate(todo.due_date);

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      onSwipeableOpen={(direction) => {
        if (direction === 'left') handleSwipeRight();
        else handleSwipeLeft();
      }}
    >
      <TouchableOpacity style={styles.container} onPress={() => onPress?.(todo)} activeOpacity={0.7}>
        <TouchableOpacity
          style={[styles.checkbox, isCompleted && styles.checkboxCompleted]}
          onPress={() => onToggleComplete?.(todo)}
        >
          {isCompleted && <Ionicons name="checkmark" size={14} color="#FFF" />}
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={[styles.title, isCompleted && styles.titleCompleted]} numberOfLines={1}>
            {todo.title}
          </Text>
          {dueDateText ? (
            <Text style={[styles.dueDate, overdue && styles.dueDateOverdue]}>
              {dueDateText}
            </Text>
          ) : null}
        </View>

        <PriorityBadge priority={todo.priority} />
      </TouchableOpacity>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.surface,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxCompleted: {
    backgroundColor: theme.colors.completedGreen,
    borderColor: theme.colors.completedGreen,
  },
  content: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '400',
    color: theme.colors.text,
  },
  titleCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textSecondary,
  },
  dueDate: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  dueDateOverdue: {
    color: theme.colors.overdueRed,
  },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  swipeRight: {
    backgroundColor: theme.colors.todayBlue,
  },
  swipeLeft: {
    backgroundColor: theme.colors.overdueRed,
  },
  swipeText: {
    color: '#FFF',
    fontSize: 12,
    marginTop: 2,
  },
});
