import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { TaskStatus } from '../../types/api';
import { hapticLight } from '../../utils/haptics';
import { translateUi } from '../../i18n';
interface SwipeActionsProps {
  children: ReactNode;
  taskId: string;
  currentStatus: TaskStatus;
  onMove: (id: string, status: TaskStatus) => void;
  onComplete: (id: string) => void;
}
const THRESHOLD = 40; // px to reveal action panel
const DIRECTION_RATIO = 1.5; // horizontal must exceed vertical by this factor
const statusLabels: Record<TaskStatus, string> = {
  pending: 'Todo',
  in_progress: 'In Progress',
  completed: 'Done',
  cancelled: 'Cancelled',
};
const allStatuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];
export default function SwipeActions({
  children,
  taskId,
  currentStatus,
  onMove,
  onComplete,
}: SwipeActionsProps) {
  const startX = useRef(0);
  const startY = useRef(0);
  const [offsetX, setOffsetX] = useState(0);
  const [locked, setLocked] = useState<'horizontal' | 'vertical' | null>(null);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const reset = useCallback(() => {
    setOffsetX(0);
    setLocked(null);
    setShowMoveMenu(false);
  }, []);
  // Close on outside touch
  useEffect(() => {
    if (offsetX === 0 && !showMoveMenu) return;
    const handler = (e: TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        reset();
      }
    };
    document.addEventListener('touchstart', handler, { passive: true });
    return () => document.removeEventListener('touchstart', handler);
  }, [offsetX, showMoveMenu, reset]);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    setLocked(null);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (!locked) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        setLocked(Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO ? 'horizontal' : 'vertical');
      }
      return;
    }
    if (locked === 'vertical') return;
    setOffsetX(dx);
  };
  const onTouchEnd = () => {
    if (locked !== 'horizontal') {
      reset();
      return;
    }
    if (offsetX < -THRESHOLD) {
      // Swiped left → show move menu
      setOffsetX(-80);
      setShowMoveMenu(true);
      hapticLight();
    } else if (offsetX > THRESHOLD) {
      // Swiped right → toggle complete
      hapticLight();
      onComplete(taskId);
      reset();
    } else {
      reset();
    }
  };
  const handleMove = (status: TaskStatus) => {
    onMove(taskId, status);
    reset();
  };
  const moveTargets = allStatuses.filter((s) => s !== currentStatus);
  const isActive = offsetX !== 0 || showMoveMenu;
  return (
    <div
      className={`cc-swipe-actions${isActive ? ' cc-swipe-actions--active' : ''}`}
      ref={containerRef}
    >
      {/* Right-side panel (revealed by swiping left) */}
      <div className="cc-swipe-actions__panel cc-swipe-actions__panel--right">
        {showMoveMenu ? (
          moveTargets.map((s) => (
            <button
              key={s}
              className="cc-swipe-actions__btn cc-swipe-actions__btn--move"
              onClick={() => handleMove(s)}
            >
              {statusLabels[s]}
            </button>
          ))
        ) : (
          <span className="cc-swipe-actions__btn cc-swipe-actions__btn--move">
            {translateUi('Move')}
          </span>
        )}
      </div>
      {/* Left-side panel (revealed by swiping right) */}
      <div className="cc-swipe-actions__panel cc-swipe-actions__panel--left">
        <span className="cc-swipe-actions__btn cc-swipe-actions__btn--complete">
          {currentStatus === 'completed' ? translateUi('Undo') : translateUi('Done')}
        </span>
      </div>
      {/* Card content */}
      <div
        className="cc-swipe-actions__content"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: locked === 'horizontal' ? 'none' : 'transform 0.2s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
