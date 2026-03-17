import { useState, useRef, useEffect, type RefObject } from 'react';
import { motion } from 'framer-motion';

interface PullToRefreshProps {
  contentRef: RefObject<HTMLDivElement | null>;
  onRefresh: () => void;
  disabled?: boolean;
}

const THRESHOLD = 60;
const MAX_PULL = 80;

export default function PullToRefresh({ contentRef, onRefresh, disabled }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const tracking = useRef(false);
  const startY = useRef(0);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || disabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (el.scrollTop <= 0) {
        tracking.current = true;
        startY.current = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking.current || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0) {
        e.preventDefault();
        setPullDistance(Math.min(dy * 0.5, MAX_PULL));
      } else {
        tracking.current = false;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      if (!tracking.current) return;
      tracking.current = false;
      if (pullDistance >= THRESHOLD) {
        setRefreshing(true);
        onRefresh();
        setTimeout(() => {
          setRefreshing(false);
          setPullDistance(0);
        }, 1000);
      } else {
        setPullDistance(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [contentRef, disabled, onRefresh, pullDistance, refreshing]);

  const visible = pullDistance > 0 || refreshing;

  if (!visible) return null;

  const pastThreshold = pullDistance >= THRESHOLD;

  return (
    <motion.div
      className="cc-pull-indicator"
      style={{ top: refreshing ? 12 : pullDistance - 40 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div
        className={`cc-pull-indicator__icon${pastThreshold && !refreshing ? ' cc-pull-indicator__icon--flipped' : ''}${refreshing ? ' cc-pull-indicator__icon--spinning' : ''}`}
      >
        {refreshing ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 8a7 7 0 0113.36-2.92M15 8A7 7 0 011.64 10.92" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v10M4 9l4 4 4-4" />
          </svg>
        )}
      </div>
    </motion.div>
  );
}
