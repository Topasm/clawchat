import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../config/ThemeContext';

export default function CustomTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const onPressAdd = () => {
    navigation.navigate('QuickCapture');
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: insets.bottom,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      ]}
    >
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
                color={isFocused ? colors.primary : colors.disabled}
              />
              <Text
                style={[
                  styles.label,
                  { color: colors.disabled },
                  isFocused && { color: colors.primary },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>

            {showFab && (
              <TouchableOpacity
                style={[styles.fab, { backgroundColor: colors.primary }]}
                onPress={onPressAdd}
                activeOpacity={0.8}
              >
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
    borderTopWidth: 1,
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
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
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
