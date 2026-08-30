import { useEffect } from 'react';
import { useWorkspaceRuntimeStore } from '../../stores/useWorkspaceRuntimeStore';

export default function WorkspaceRuntimeInitializer() {
  const initializeRuntime = useWorkspaceRuntimeStore((state) => state.initialize);

  useEffect(() => {
    void initializeRuntime();
  }, [initializeRuntime]);

  return null;
}
