import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import usePlatform from './usePlatform';

/**
 * On a desktop-sized screen a task opens beside the list it was picked from,
 * and the URL carries the choice as `?task=<id>` so a refresh restores it.
 * A phone has no room beside the list, so there the task gets its own page.
 */
export const TASK_PANE_PARAM = 'task';

/** The task shown in the pane beside the current screen, or null. */
export function useSelectedTaskId(): string | null {
  const [searchParams] = useSearchParams();
  return searchParams.get(TASK_PANE_PARAM);
}

/** Open a task from a list: in the pane on desktop, on its page on a phone. */
export function useOpenTask(): (taskId: string) => void {
  const { isMobile } = usePlatform();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  return useCallback(
    (taskId: string) => {
      if (isMobile) {
        navigate(`/tasks/${taskId}`);
        return;
      }
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set(TASK_PANE_PARAM, taskId);
        return next;
      });
    },
    [isMobile, navigate, setSearchParams],
  );
}

/** Close the pane: the screen stays, the task leaves the URL. */
export function useCloseTaskPane(): () => void {
  const [, setSearchParams] = useSearchParams();
  return useCallback(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(TASK_PANE_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);
}
