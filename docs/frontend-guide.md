# Frontend Guide

The ClawChat mobile app is built with React Native (Expo), adapting navigation and component patterns from the [react-native-chat](https://github.com/Ctere1/react-native-chat) reference project while replacing Firebase with a self-hosted REST + WebSocket backend and React Context with Zustand.

## Directory Structure

```
app/
├── App.js                          # Root: providers, navigation
├── app.json                        # Expo config
├── package.json
├── screens/
│   ├── ChatScreen.js               # AI conversation (GiftedChat + streaming)
│   ├── AssistantScreen.js          # Module dashboard (todos, events, memos)
│   ├── SettingsScreen.js           # Configuration and account
│   ├── LoginScreen.js              # Server URL + PIN authentication
│   └── ConversationListScreen.js   # Chat history list
├── components/
│   ├── ActionCard.js               # Interactive cards for AI actions (new)
│   ├── StreamingText.js            # Animated text for streaming responses (new)
│   ├── QuickActionBar.js           # Shortcut buttons above chat input (new)
│   ├── ContactRow.js               # Reusable list row (from reference)
│   ├── Cell.js                     # Settings menu cell (from reference)
│   └── Separator.js                # List separator
├── stores/
│   ├── useAuthStore.js             # Authentication state (Zustand)
│   ├── useChatStore.js             # Conversations & messages (Zustand)
│   └── useModuleStore.js           # Todos, events, memos (Zustand)
├── services/
│   ├── apiClient.js                # Axios REST client
│   └── wsManager.js                # WebSocket connection manager
├── config/
│   └── theme.js                    # Colors, typography, spacing
└── utils/
    └── formatters.js               # Date/time formatting helpers
```

## Pattern Migration Guide

This section maps patterns from the reference project to ClawChat equivalents. Each subsection shows the reference approach and the adapted ClawChat approach.

---

### Navigation

**Reference (`App.js`)**:
The reference project uses a conditional navigator pattern — `AuthStack` (Login/SignUp) when no user is authenticated, `MainStack` (tabs + screens) when authenticated. Bottom tabs contain Chats and Settings.

```javascript
// Reference pattern
const RootNavigator = () => {
  const { user } = useContext(AuthenticatedUserContext);
  return (
    <NavigationContainer>
      {user ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
};

// TabNavigator has: Chats, Settings
```

**ClawChat adaptation**:
Keep the same conditional auth/main stack pattern. Replace Context with Zustand. Update tabs to Chat + Assistant + Settings.

```javascript
// ClawChat pattern
import { useAuthStore } from './stores/useAuthStore';

const TabNavigator = () => (
  <Tab.Navigator
    screenOptions={({ route }) => ({
      tabBarIcon: ({ focused, color, size }) => {
        const icons = {
          Chat: 'chatbubbles',
          Assistant: 'grid',
          Settings: 'settings',
        };
        const name = icons[route.name] + (focused ? '' : '-outline');
        return <Ionicons name={name} size={size} color={color} />;
      },
      tabBarActiveTintColor: theme.colors.primary,
    })}
  >
    <Tab.Screen name="Chat" component={ConversationListScreen} />
    <Tab.Screen name="Assistant" component={AssistantScreen} />
    <Tab.Screen name="Settings" component={SettingsScreen} />
  </Tab.Navigator>
);

const RootNavigator = () => {
  const { token, isLoading } = useAuthStore();

  if (isLoading) return <LoadingScreen />;
  return (
    <NavigationContainer>
      {token ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
};
```

---

### Chat Screen

**Reference (`Chat.js`)**:
Uses GiftedChat with Firestore `onSnapshot` for real-time updates. Custom `RenderBubble` and `RenderInputToolbar`. Messages fetched from Firestore document.

```javascript
// Reference: Firestore real-time listener
useEffect(() => {
  const unsubscribe = onSnapshot(doc(database, 'chats', route.params.id), (document) => {
    setMessages(document.data().messages.map(/* ... */));
  });
  return () => unsubscribe();
}, [route.params.id]);
```

**ClawChat adaptation**:
Replace Firestore with WebSocket for streaming AI responses. Extend GiftedChat with custom message types for streaming text and action cards.

```javascript
// ClawChat: WebSocket streaming
import { wsManager } from '../services/wsManager';
import { useChatStore } from '../stores/useChatStore';

function ChatScreen({ route }) {
  const { messages, addMessage, appendToLastMessage } = useChatStore();
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    // Load conversation messages via REST
    apiClient.get(`/chat/conversations/${route.params.id}/messages`)
      .then(res => useChatStore.getState().setMessages(res.data.items));

    // WebSocket handlers for streaming
    const handlers = {
      stream_start: ({ message_id }) => {
        setIsStreaming(true);
        addMessage({ _id: message_id, text: '', user: { _id: 'assistant' } });
      },
      stream_chunk: ({ content }) => {
        appendToLastMessage(content);
      },
      stream_end: ({ full_content }) => {
        setIsStreaming(false);
      },
      action_card: ({ card_type, payload, actions }) => {
        addMessage({
          _id: payload.id,
          text: '',
          user: { _id: 'assistant' },
          actionCard: { card_type, payload, actions },
        });
      },
    };

    wsManager.subscribe(handlers);
    return () => wsManager.unsubscribe(handlers);
  }, [route.params.id]);

  const onSend = useCallback(async (newMessages = []) => {
    addMessage(newMessages[0]);
    await apiClient.post('/chat/send', {
      conversation_id: route.params.id,
      content: newMessages[0].text,
    });
  }, [route.params.id]);

  return (
    <GiftedChat
      messages={messages}
      onSend={onSend}
      user={{ _id: 'user' }}
      renderBubble={(props) => <CustomBubble {...props} />}
      renderInputToolbar={(props) => <CustomInputToolbar {...props} isStreaming={isStreaming} />}
      renderCustomView={(props) =>
        props.currentMessage.actionCard
          ? <ActionCard card={props.currentMessage.actionCard} />
          : null
      }
      renderFooter={() => isStreaming ? <TypingIndicator /> : null}
    />
  );
}
```

---

### State Management

**Reference (Context API)**:
Uses `AuthenticatedUserContext` and `UnreadMessagesContext` with `useState` + `useMemo`.

```javascript
// Reference: AuthenticatedUserContext.js
export const AuthenticatedUserProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (authenticatedUser) => {
      setUser(authenticatedUser || null);
    });
    return unsubscribe;
  }, []);
  const value = useMemo(() => ({ user, setUser }), [user]);
  return (
    <AuthenticatedUserContext.Provider value={value}>
      {children}
    </AuthenticatedUserContext.Provider>
  );
};
```

**ClawChat adaptation (Zustand)**:
Replace Context providers with Zustand stores. No provider nesting needed.

```javascript
// stores/useAuthStore.js
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      serverUrl: null,
      isLoading: true,

      login: async (serverUrl, pin) => {
        const response = await fetch(`${serverUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin }),
        });
        const data = await response.json();
        set({ token: data.access_token, serverUrl, isLoading: false });
      },

      logout: () => set({ token: null, serverUrl: null }),
      setLoading: (isLoading) => set({ isLoading }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setLoading(false);
      },
    }
  )
);

// stores/useChatStore.js
export const useChatStore = create((set, get) => ({
  conversations: [],
  messages: [],
  currentConversationId: null,

  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({
    messages: [message, ...state.messages],
  })),
  appendToLastMessage: (content) => set((state) => {
    const updated = [...state.messages];
    if (updated.length > 0) {
      updated[0] = { ...updated[0], text: updated[0].text + content };
    }
    return { messages: updated };
  }),
}));
```

---

### API Client

**Reference (`firebase.js`)**:
Initializes Firebase app, auth, and Firestore with config from Expo constants.

```javascript
// Reference: firebase.js
const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, { persistence });
export const database = getFirestore();
```

**ClawChat adaptation (Axios + WebSocket)**:
Replace Firebase with an Axios client pointing at the user's server, plus a WebSocket manager.

```javascript
// services/apiClient.js
import axios from 'axios';
import { useAuthStore } from '../stores/useAuthStore';

const apiClient = axios.create();

apiClient.interceptors.request.use((config) => {
  const { token, serverUrl } = useAuthStore.getState();
  config.baseURL = `${serverUrl}/api`;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default apiClient;

// services/wsManager.js
class WebSocketManager {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect(serverUrl, token) {
    const wsUrl = serverUrl.replace(/^http/, 'ws');
    this.ws = new WebSocket(`${wsUrl}/ws?token=${token}`);

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.listeners.forEach((handlers) => {
        if (handlers[message.type]) {
          handlers[message.type](message.data);
        }
      });
    };

    this.ws.onclose = () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(serverUrl, token), 1000 * this.reconnectAttempts);
      }
    };
  }

  subscribe(handlers) {
    const id = Symbol();
    this.listeners.set(id, handlers);
    return id;
  }

  unsubscribe(id) {
    this.listeners.delete(id);
  }

  send(type, data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}

export const wsManager = new WebSocketManager();
```

---

### Components

**Reused from reference** (with minimal changes):

- **`ContactRow`** — Used for conversation list rows. Keep the avatar, name, subtitle, forward icon pattern. Add an `aiIndicator` prop for showing AI status.
- **`Cell`** — Used for settings menu items. Keep the icon + title + subtitle + forward icon pattern.

**New components for ClawChat**:

#### `ActionCard`
Renders interactive cards for AI actions (todo created, event scheduled, etc.).

```javascript
// components/ActionCard.js
const ActionCard = ({ card }) => {
  const { card_type, payload, actions } = card;

  const renderContent = () => {
    switch (card_type) {
      case 'todo_created':
        return (
          <View style={styles.card}>
            <Ionicons name="checkbox-outline" size={20} color={theme.colors.success} />
            <Text style={styles.cardTitle}>{payload.title}</Text>
            {payload.due_date && <Text style={styles.cardMeta}>Due: {formatDate(payload.due_date)}</Text>}
          </View>
        );
      case 'event_created':
        return (
          <View style={styles.card}>
            <Ionicons name="calendar-outline" size={20} color={theme.colors.primary} />
            <Text style={styles.cardTitle}>{payload.title}</Text>
            <Text style={styles.cardMeta}>{formatDateTime(payload.start_time)}</Text>
          </View>
        );
      // ... other card types
    }
  };

  return (
    <View style={styles.container}>
      {renderContent()}
      <View style={styles.actionsRow}>
        {actions?.map((action) => (
          <TouchableOpacity key={action.action} style={styles.actionButton}
            onPress={() => wsManager.send('action_response', action)}>
            <Text style={styles.actionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};
```

#### `StreamingText`
Renders text that grows character-by-character as the AI streams its response.

```javascript
// components/StreamingText.js
const StreamingText = ({ text, isStreaming }) => (
  <Text style={styles.text}>
    {text}
    {isStreaming && <Text style={styles.cursor}>|</Text>}
  </Text>
);
```

#### `QuickActionBar`
Shortcut buttons above the chat input for common actions.

```javascript
// components/QuickActionBar.js
const QUICK_ACTIONS = [
  { label: 'New Todo', icon: 'checkbox-outline', prefix: 'Create a todo: ' },
  { label: 'Schedule', icon: 'calendar-outline', prefix: 'Schedule: ' },
  { label: 'Note', icon: 'document-text-outline', prefix: 'Save a note: ' },
  { label: 'Briefing', icon: 'sunny-outline', prefix: 'Give me my daily briefing' },
];

const QuickActionBar = ({ onAction }) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar}>
    {QUICK_ACTIONS.map((action) => (
      <TouchableOpacity key={action.label} style={styles.chip}
        onPress={() => onAction(action.prefix)}>
        <Ionicons name={action.icon} size={16} color={theme.colors.primary} />
        <Text style={styles.chipLabel}>{action.label}</Text>
      </TouchableOpacity>
    ))}
  </ScrollView>
);
```

---

### Styling / Theme

**Reference (`constants.js`)**:
Minimal color constants.

```javascript
// Reference
export const colors = {
  primary: '#2196f3',
  border: '#565656',
  red: '#EF5350',
  pink: '#EC407A',
  teal: '#26A69A',
  grey: '#BDBDBD',
};
```

**ClawChat adaptation (`theme.js`)**:
Expand into a full theme system with colors, typography, spacing, and component-specific tokens.

```javascript
// config/theme.js
export const theme = {
  colors: {
    primary: '#2196F3',
    primaryLight: '#64B5F6',
    primaryDark: '#1976D2',
    secondary: '#26A69A',
    success: '#4CAF50',
    warning: '#FF9800',
    error: '#EF5350',
    background: '#F5F5F5',
    surface: '#FFFFFF',
    text: '#212121',
    textSecondary: '#757575',
    border: '#E0E0E0',
    disabled: '#BDBDBD',

    // AI-specific
    assistantBubble: '#F0F4F8',
    userBubble: '#2196F3',
    streaming: '#26A69A',
    actionCard: '#FFF8E1',
  },
  typography: {
    h1: { fontSize: 24, fontWeight: '700' },
    h2: { fontSize: 20, fontWeight: '600' },
    body: { fontSize: 16, fontWeight: '400' },
    caption: { fontSize: 12, fontWeight: '400', color: '#757575' },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 16,
    full: 9999,
  },
};
```

---

### Login Screen

**Reference (`Login.js`)**:
Email + password form with Firebase Auth.

**ClawChat adaptation**:
Replace with server URL + PIN form. The user enters their self-hosted server address and authenticates with a PIN.

```javascript
// screens/LoginScreen.js
function LoginScreen() {
  const [serverUrl, setServerUrl] = useState('');
  const [pin, setPin] = useState('');
  const { login } = useAuthStore();

  const handleLogin = async () => {
    try {
      await login(serverUrl, pin);
    } catch (error) {
      Alert.alert('Connection failed', 'Check your server URL and PIN.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>ClawChat</Text>
      <Text style={styles.subtitle}>Connect to your server</Text>
      <TextInput
        style={styles.input}
        placeholder="Server URL (e.g., https://192.168.1.100:8000)"
        value={serverUrl}
        onChangeText={setServerUrl}
        autoCapitalize="none"
        keyboardType="url"
      />
      <TextInput
        style={styles.input}
        placeholder="PIN"
        value={pin}
        onChangeText={setPin}
        secureTextEntry
        keyboardType="number-pad"
      />
      <TouchableOpacity style={styles.button} onPress={handleLogin}>
        <Text style={styles.buttonText}>Connect</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
```

---

## Dependencies

### Kept from Reference

| Package | Purpose |
|---------|---------|
| `expo` | Build and development framework |
| `@react-navigation/native` | Navigation core |
| `@react-navigation/bottom-tabs` | Tab navigator |
| `@react-navigation/stack` | Stack navigator |
| `react-native-gifted-chat` | Chat UI components |
| `@expo/vector-icons` | Ionicons and other icon sets |
| `@react-native-async-storage/async-storage` | Local persistent storage |
| `react-native-safe-area-context` | Safe area handling |
| `react-native-screens` | Native screen containers |
| `react-native-gesture-handler` | Gesture support |
| `react-native-reanimated` | Animation library |

### Added for ClawChat

| Package | Purpose |
|---------|---------|
| `zustand` | State management (replaces React Context) |
| `axios` | HTTP client for REST API |

### Removed (Firebase)

| Package | Reason |
|---------|--------|
| `firebase` | Replaced by self-hosted REST API + WebSocket |
| `react-native-emoji-modal` | Not needed for AI assistant UX |
| `react-native-popup-menu` | Replaced by simpler action patterns |
| `react-native-uuid` | Use built-in `crypto.randomUUID()` or expo-crypto |
