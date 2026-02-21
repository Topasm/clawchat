import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { theme } from './config/theme';
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

const headerStyle = {
  backgroundColor: theme.colors.surface,
  shadowColor: theme.colors.border,
};
const headerTintColor = theme.colors.text;
const headerTitleStyle = { fontWeight: '600' };

// --- Tab Navigator ---
function TabNavigator() {
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
