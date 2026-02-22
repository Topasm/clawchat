import { useRef, useCallback } from 'react';
import { hapticMedium } from '../utils/haptics';

const IS_TOUCH = typeof window !== 'undefined' && 'ontouchstart' in window;
const LONG_PRESS_MS = 400;
const MOVE_THRESHOLD = 10; // px – cancel if finger moves more than this

interface UseTouchSelectOptions {
  taskId: string;
  onSelect: (id: string) => void;
}

/**
 * Long-press (400 ms) on a kanban card toggles multi-select on touch devices.
 * Uses a longer threshold than @hello-pangea/dnd's 120 ms drag activation so
 * the two gestures don't conflict. Cancels if the finger moves (scroll / drag).
 */
export default function useTouchSelect({ taskId, onSelect }: UseTouchSelectOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef({ x: 0, y: 0 });

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH) return;
      const touch = e.touches[0];
      startPos.current = { x: touch.clientX, y: touch.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onSelect(taskId);
        hapticMedium();
      }, LONG_PRESS_MS);
    },
    [taskId, onSelect],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (timerRef.current === null) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startPos.current.x;
      const dy = touch.clientY - startPos.current.y;
      if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
        clear();
      }
    },
    [clear],
  );

  const onTouchEnd = useCallback(() => {
    clear();
  }, [clear]);

  if (!IS_TOUCH) return {};
  return { onTouchStart, onTouchMove, onTouchEnd };
}
