import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './app/config/ThemeProvider';
import { queryClient } from './app/config/queryClient';
import { initializeQueryCachePersistence } from './app/config/queryCachePersistence';
import ErrorBoundary from './app/components/shared/ErrorBoundary';
import NativeEventBridge from './app/components/NativeEventBridge';
import AppRouter from './router';
import { initializeUpdateLifecycle } from './app/services/updateLifecycle';
import { useAuthStore } from './app/stores/useAuthStore';
import { useWorkspaceStore } from './app/stores/useWorkspaceStore';
import { saveWorkspaceSession } from './app/services/workspaceCredentials';

initializeQueryCachePersistence();

function ActiveRemoteSessionPersistence() {
  useEffect(() => {
    const persistActiveRemoteSession = () => {
      const auth = useAuthStore.getState();
      const workspace = useWorkspaceStore.getState();
      const profile = workspace.profiles.find(
        (candidate) => candidate.kind === 'remote' && candidate.id === workspace.activeWorkspaceId,
      );
      if (!profile?.credentialRef || !auth.token || !auth.serverUrl) return;
      const endpointMatches = profile.endpoints.some(
        (endpoint) =>
          endpoint.url.replace(/\/+$/, '').toLowerCase() ===
          auth.serverUrl?.replace(/\/+$/, '').toLowerCase(),
      );
      if (!endpointMatches) return;
      void saveWorkspaceSession(profile.credentialRef, {
        token: auth.token,
        refreshToken: auth.refreshToken,
        serverUrl: auth.serverUrl,
        hostId: auth.hostId,
        hostPublicKey: auth.hostPublicKey,
        relayUrl: auth.relayUrl,
      });
    };
    const stopAuth = useAuthStore.subscribe(persistActiveRemoteSession);
    const stopWorkspace = useWorkspaceStore.subscribe(persistActiveRemoteSession);
    persistActiveRemoteSession();
    return () => {
      stopAuth();
      stopWorkspace();
    };
  }, []);

  return null;
}

export default function App() {
  useEffect(() => {
    initializeUpdateLifecycle();
  }, []);

  return (
    <ErrorBoundary name="App">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter>
            <NativeEventBridge />
            <ActiveRemoteSessionPersistence />
            <AppRouter />
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
