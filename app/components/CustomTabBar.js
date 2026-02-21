import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../config/theme';

export default function CustomTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();

  const onPressAdd = () => {
    navigation.navigate('QuickCapture');
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = options.tabBarLabel ?? options.title ?? route.name;
        const isFocused = state.index === index;

        const iconMap = {
          Today: isFocused ? 'star' : 'star-outline',
          Inbox: isFocused ? 'file-tray' : 'file-tray-outline',
          Chat: isFocused ? 'chatbubbles' : 'chatbubbles-outline',
          Settings: isFocused ? 'settings' : 'settings-outline',
        };

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        // Insert FAB after Inbox (index 1)
        const showFab = index === 1;

        return (
          <React.Fragment key={route.key}>
            <TouchableOpacity
              style={styles.tab}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
            >
              <Ionicons
                name={iconMap[route.name] || 'ellipse-outline'}
                size={24}
                color={isFocused ? theme.colors.primary : theme.colors.disabled}
              />
              <Text style={[styles.label, isFocused && styles.labelFocused]}>
                {label}
              </Text>
            </TouchableOpacity>

            {showFab && (
              <TouchableOpacity style={styles.fab} onPress={onPressAdd} activeOpacity={0.8}>
                <Ionicons name="add" size={28} color="#FFF" />
              </TouchableOpacity>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  label: {
    fontSize: 10,
    marginTop: 2,
    color: theme.colors.disabled,
  },
  labelFocused: {
    color: theme.colors.primary,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -28,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
