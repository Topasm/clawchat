import NativeCommandBridge from './NativeCommandBridge';
import RemoteSessionPersistence from './RemoteSessionPersistence';
import WorkspaceRuntimeInitializer from './WorkspaceRuntimeInitializer';

export default function AppRuntimeServices() {
  return (
    <>
      <NativeCommandBridge />
      <WorkspaceRuntimeInitializer />
      <RemoteSessionPersistence />
    </>
  );
}
