import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from './config/theme';
import { useAuthStore } from './stores/useAuthStore';

// Screens
import LoginScreen from './screens/LoginScreen';
import ConversationListScreen from './screens/ConversationListScreen';
import ChatScreen from './screens/ChatScreen';
import AssistantScreen from './screens/AssistantScreen';
import SettingsScreen from './screens/SettingsScreen';

const AuthStackNav = createStackNavigator();
const MainStackNav = createStackNavigator();
const Tab = createBottomTabNavigator();

// --- Auth Stack (unauthenticated) ---
function AuthStack() {
  return (
    <AuthStackNav.Navigator screenOptions={{ headerShown: false }}>
      <AuthStackNav.Screen name="Login" component={LoginScreen} />
    </AuthStackNav.Navigator>
  );
}

// --- Tab Navigator ---
function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          const icons = {
            Chat: 'chatbubbles',
            Assistant: 'grid',
            Settings: 'settings',
          };
          const iconName = icons[route.name] + (focused ? '' : '-outline');
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.disabled,
        tabBarStyle: {
          borderTopColor: theme.colors.border,
        },
        headerStyle: {
          backgroundColor: theme.colors.surface,
          shadowColor: theme.colors.border,
        },
        headerTintColor: theme.colors.text,
        headerTitleStyle: {
          fontWeight: '600',
        },
      })}
    >
      <Tab.Screen
        name="Chat"
        component={ConversationListScreen}
        options={{ title: 'Chats' }}
      />
      <Tab.Screen
        name="Assistant"
        component={AssistantScreen}
        options={{ headerShown: false }}
      />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

// --- Main Stack (authenticated: tabs + chat detail) ---
function MainStack() {
  return (
    <MainStackNav.Navigator>
      <MainStackNav.Screen
        name="Tabs"
        component={TabNavigator}
        options={{ headerShown: false }}
      />
      <MainStackNav.Screen
        name="ChatScreen"
        component={ChatScreen}
        options={{
          title: 'Chat',
          headerStyle: {
            backgroundColor: theme.colors.surface,
            shadowColor: theme.colors.border,
          },
          headerTintColor: theme.colors.text,
          headerTitleStyle: {
            fontWeight: '600',
          },
          headerBackTitleVisible: false,
        }}
      />
    </MainStackNav.Navigator>
  );
}

// --- Root Navigator: loading / auth / main ---
function RootNavigator() {
  const token = useAuthStore((s) => s.token);
  const isLoading = useAuthStore((s) => s.isLoading);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {token ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
}

// --- App Entry ---
export default function App() {
  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
});
