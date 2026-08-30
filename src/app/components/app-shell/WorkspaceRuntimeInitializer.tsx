import { useEffect } from 'react';

export default function WorkspaceRuntimeInitializer() {
  useEffect(() => {
    let disposed = false;

    void import('../../stores/useWorkspaceRuntimeStore').then(({ useWorkspaceRuntimeStore }) => {
      if (!disposed) void useWorkspaceRuntimeStore.getState().initialize();
    });

    return () => {
      disposed = true;
    };
  }, []);

  return null;
}
