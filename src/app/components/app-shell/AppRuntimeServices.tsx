import DeferredDeleteRuntime from './DeferredDeleteRuntime';
import NativeCommandBridge from './NativeCommandBridge';
import RemoteSessionPersistence from './RemoteSessionPersistence';
import WorkspaceRuntimeInitializer from './WorkspaceRuntimeInitializer';

export default function AppRuntimeServices() {
  return (
    <>
      <DeferredDeleteRuntime />
      <NativeCommandBridge />
      <WorkspaceRuntimeInitializer />
      <RemoteSessionPersistence />
    </>
  );
}
