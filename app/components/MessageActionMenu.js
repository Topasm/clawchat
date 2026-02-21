import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { theme } from '../config/theme';

/**
 * MessageActionMenu - Context menu shown on long-press of a chat message.
 *
 * For assistant messages: Copy, Regenerate, Delete
 * For user messages: Copy, Edit, Delete
 *
 * Uses a bottom-sheet style modal with a semi-transparent backdrop,
 * rounded card with action rows, and subtle slide-up + fade-in animation.
 */

const ACTION_ICONS = {
  copy: 'content-copy',
  regenerate: 'refresh',
  edit: 'pencil',
  delete: 'delete-outline',
};

export default function MessageActionMenu({
  visible,
  message,
  onClose,
  onCopy,
  onRegenerate,
  onEdit,
  onDelete,
}) {
  const slideAnim = useRef(new Animated.Value(300)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      slideAnim.setValue(300);
      backdropAnim.setValue(0);
    }
  }, [visible, slideAnim, backdropAnim]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose?.();
    });
  };

  const handleDelete = () => {
    handleClose();
    // Use setTimeout to let the modal close before showing the alert
    setTimeout(() => {
      Alert.alert(
        'Delete Message',
        'Are you sure you want to delete this message?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => onDelete?.(message),
          },
        ]
      );
    }, 250);
  };

  const handleCopy = () => {
    handleClose();
    setTimeout(() => onCopy?.(message), 250);
  };

  const handleRegenerate = () => {
    handleClose();
    setTimeout(() => onRegenerate?.(message), 250);
  };

  const handleEdit = () => {
    handleClose();
    setTimeout(() => onEdit?.(message), 250);
  };

  if (!message) return null;

  const isUserMessage = message.user?._id === 'user';
  const messagePreview =
    message.text?.length > 60
      ? message.text.substring(0, 60) + '...'
      : message.text;

  const actions = isUserMessage
    ? [
        { key: 'copy', label: 'Copy', icon: ACTION_ICONS.copy, handler: handleCopy },
        { key: 'edit', label: 'Edit & Resend', icon: ACTION_ICONS.edit, handler: handleEdit },
        {
          key: 'delete',
          label: 'Delete',
          icon: ACTION_ICONS.delete,
          handler: handleDelete,
          destructive: true,
        },
      ]
    : [
        { key: 'copy', label: 'Copy', icon: ACTION_ICONS.copy, handler: handleCopy },
        {
          key: 'regenerate',
          label: 'Regenerate Response',
          icon: ACTION_ICONS.regenerate,
          handler: handleRegenerate,
        },
        {
          key: 'delete',
          label: 'Delete',
          icon: ACTION_ICONS.delete,
          handler: handleDelete,
          destructive: true,
        },
      ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <Animated.View
          style={[styles.backdrop, { opacity: backdropAnim }]}
        />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.menuContainer,
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Message preview */}
        <View style={styles.previewContainer}>
          <Text style={styles.previewLabel}>
            {isUserMessage ? 'Your message' : 'Assistant message'}
          </Text>
          <Text style={styles.previewText} numberOfLines={2}>
            {messagePreview}
          </Text>
        </View>

        {/* Separator */}
        <View style={styles.separator} />

        {/* Action rows */}
        {actions.map((action, index) => (
          <TouchableOpacity
            key={action.key}
            style={[
              styles.actionRow,
              index === actions.length - 1 && styles.actionRowLast,
            ]}
            onPress={action.handler}
            activeOpacity={0.6}
          >
            <MaterialCommunityIcons
              name={action.icon}
              size={22}
              color={action.destructive ? theme.colors.error : theme.colors.text}
            />
            <Text
              style={[
                styles.actionLabel,
                action.destructive && styles.actionLabelDestructive,
              ]}
            >
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}

        {/* Cancel button */}
        <View style={styles.cancelSeparator} />
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleClose}
          activeOpacity={0.6}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  menuContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34, // safe area bottom
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  previewContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  previewText: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginHorizontal: 20,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 14,
  },
  actionRowLast: {
    // no special styling needed
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: '400',
    color: theme.colors.text,
  },
  actionLabelDestructive: {
    color: theme.colors.error,
    fontWeight: '500',
  },
  cancelSeparator: {
    height: 8,
    backgroundColor: theme.colors.background,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: theme.colors.surface,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
  },
});
