import { lazy, Suspense } from 'react';

import BackgroundRunNotice from './BackgroundRunNotice';
import NativeCommandBridge from './NativeCommandBridge';
import RemoteSessionPersistence from './RemoteSessionPersistence';
import WorkspaceRuntimeInitializer from './WorkspaceRuntimeInitializer';

const DeferredDeleteRuntime = lazy(() => import('./DeferredDeleteRuntime'));

export default function AppRuntimeServices() {
  return (
    <>
      <Suspense fallback={null}>
        <DeferredDeleteRuntime />
      </Suspense>
      <NativeCommandBridge />
      <BackgroundRunNotice />
      <WorkspaceRuntimeInitializer />
      <RemoteSessionPersistence />
    </>
  );
}
