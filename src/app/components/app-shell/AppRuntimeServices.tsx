import { lazy, Suspense } from 'react';

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
      <WorkspaceRuntimeInitializer />
      <RemoteSessionPersistence />
    </>
  );
}
