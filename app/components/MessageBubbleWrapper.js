import React, { useRef, useState, useCallback } from 'react';
import { Animated, Pressable, View, Text, StyleSheet } from 'react-native';
import { Bubble } from 'react-native-gifted-chat';
import { theme } from '../config/theme';

/**
 * MessageBubbleWrapper - Wraps GiftedChat Bubble to add interaction handlers.
 *
 * Features:
 * - onLongPress: triggers the MessageActionMenu
 * - Visual feedback: brief scale animation on press
 * - Timestamp toggle: tap to show/hide the exact timestamp
 * - Selection highlight when a message is selected
 * - Optional haptic feedback (uses expo-haptics if available)
 */

let Haptics = null;
try {
  Haptics = require('expo-haptics');
} catch {
  // expo-haptics not available; skip haptic feedback
}

export default function MessageBubbleWrapper(props) {
  const { currentMessage, onLongPress, selectedMessageId } = props;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [showTimestamp, setShowTimestamp] = useState(false);

  const isSelected = selectedMessageId === currentMessage?._id;

  const triggerHaptic = useCallback(async () => {
    if (Haptics) {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // Haptics not supported on this device
      }
    }
  }, []);

  const handlePressIn = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: 0.96,
      duration: 100,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handleLongPress = useCallback(() => {
    triggerHaptic();
    onLongPress?.(currentMessage);
  }, [currentMessage, onLongPress, triggerHaptic]);

  const handlePress = useCallback(() => {
    setShowTimestamp((prev) => !prev);
  }, []);

  const formatTimestamp = (date) => {
    if (!date) return '';
    const d = new Date(date);
    const hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const month = d.toLocaleDateString(undefined, { month: 'short' });
    const day = d.getDate();
    return `${month} ${day}, ${displayHours}:${minutes} ${ampm}`;
  };

  // Strip out our custom props before passing to Bubble
  const {
    onLongPress: _onLongPress,
    selectedMessageId: _selectedMessageId,
    ...bubbleProps
  } = props;

  return (
    <View>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={handleLongPress}
        onPress={handlePress}
        delayLongPress={400}
      >
        <Animated.View
          style={[
            { transform: [{ scale: scaleAnim }] },
            isSelected && styles.selectedHighlight,
          ]}
        >
          <Bubble
            {...bubbleProps}
            wrapperStyle={{
              left: { backgroundColor: theme.colors.assistantBubble },
              right: { backgroundColor: theme.colors.userBubble },
            }}
            textStyle={{
              left: { color: theme.colors.text },
              right: { color: theme.colors.surface },
            }}
            // Disable built-in long press since we handle it ourselves
            onLongPress={() => {}}
          />
        </Animated.View>
      </Pressable>

      {showTimestamp && currentMessage?.createdAt && (
        <View
          style={[
            styles.timestampContainer,
            currentMessage.user?._id === 'user'
              ? styles.timestampRight
              : styles.timestampLeft,
          ]}
        >
          <Text style={styles.timestampText}>
            {formatTimestamp(currentMessage.createdAt)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  selectedHighlight: {
    backgroundColor: 'rgba(33, 150, 243, 0.08)',
    borderRadius: 12,
  },
  timestampContainer: {
    paddingHorizontal: 12,
    paddingVertical: 2,
    marginBottom: 2,
  },
  timestampLeft: {
    alignItems: 'flex-start',
  },
  timestampRight: {
    alignItems: 'flex-end',
  },
  timestampText: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontWeight: '400',
  },
});
