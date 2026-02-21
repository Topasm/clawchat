import React, { useMemo } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import {
  NavigationContainer,
  DefaultTheme as NavDefaultTheme,
  DarkTheme as NavDarkTheme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ThemeProvider from './config/ThemeProvider';
import { useTheme } from './config/ThemeContext';
import { useAuthStore } from './stores/useAuthStore';
import CustomTabBar from './components/CustomTabBar';

// Screens
import LoginScreen from './screens/LoginScreen';
import TodayScreen from './screens/TodayScreen';
import InboxScreen from './screens/InboxScreen';
import ConversationListScreen from './screens/ConversationListScreen';
import ChatScreen from './screens/ChatScreen';
import SettingsScreen from './screens/SettingsScreen';
import QuickCaptureModal from './screens/QuickCaptureModal';
import TaskDetailScreen from './screens/TaskDetailScreen';
import EventDetailScreen from './screens/EventDetailScreen';
import AllTasksScreen from './screens/AllTasksScreen';
import SystemPromptScreen from './screens/SystemPromptScreen';

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
  const { colors } = useTheme();

  const headerStyle = {
    backgroundColor: colors.surface,
    shadowColor: colors.border,
  };
  const headerTintColor = colors.text;
  const headerTitleStyle = { fontWeight: '600' };

  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerStyle,
        headerTintColor,
        headerTitleStyle,
      }}
    >
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Inbox" component={InboxScreen} />
      <Tab.Screen
        name="Chat"
        component={ConversationListScreen}
        options={{ title: 'Chats' }}
      />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

// --- Main Stack (authenticated: tabs + detail screens) ---
function MainStack() {
  const { colors } = useTheme();

  const headerStyle = {
    backgroundColor: colors.surface,
    shadowColor: colors.border,
  };
  const headerTintColor = colors.text;
  const headerTitleStyle = { fontWeight: '600' };

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
          headerStyle,
          headerTintColor,
          headerTitleStyle,
          headerBackTitleVisible: false,
        }}
      />
      <MainStackNav.Screen
        name="TaskDetail"
        component={TaskDetailScreen}
        options={{
          title: 'Task',
          headerStyle,
          headerTintColor,
          headerTitleStyle,
          headerBackTitleVisible: false,
        }}
      />
      <MainStackNav.Screen
        name="EventDetail"
        component={EventDetailScreen}
        options={{
          title: 'Event',
          headerStyle,
          headerTintColor,
          headerTitleStyle,
          headerBackTitleVisible: false,
        }}
      />
      <MainStackNav.Screen
        name="AllTasks"
        component={AllTasksScreen}
        options={{
          title: 'All Tasks',
          headerStyle,
          headerTintColor,
          headerTitleStyle,
          headerBackTitleVisible: false,
        }}
      />
      <MainStackNav.Screen
        name="SystemPrompt"
        component={SystemPromptScreen}
        options={{
          title: 'System Prompt',
          headerStyle,
          headerTintColor,
          headerTitleStyle,
          headerBackTitleVisible: false,
        }}
      />
      <MainStackNav.Screen
        name="QuickCapture"
        component={QuickCaptureModal}
        options={{
          presentation: 'modal',
          headerShown: false,
        }}
      />
    </MainStackNav.Navigator>
  );
}

// --- Root Navigator: loading / auth / main ---
function RootNavigator() {
  const token = useAuthStore((s) => s.token);
  const isLoading = useAuthStore((s) => s.isLoading);
  const { colors, isDark } = useTheme();

  // Merge our custom colors into the React Navigation theme
  const navigationTheme = useMemo(() => {
    const base = isDark ? NavDarkTheme : NavDefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.error,
      },
    };
  }, [isDark, colors]);

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      {token ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
}

// --- App Entry ---
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
