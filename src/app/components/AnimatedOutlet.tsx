import { useEffect, useMemo, useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

export default function AnimatedOutlet() {
  const location = useLocation();
  const outlet = useOutlet();
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Freeze the current outlet so it stays rendered during exit animation
  // (React Router v7 returns null for the old route on navigate)
  const frozenOutlet = useMemo(() => outlet, [location.pathname]);

  if (isMobile) {
    return <>{outlet}</>;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.15, ease: 'easeInOut' }}
      >
        {frozenOutlet}
      </motion.div>
    </AnimatePresence>
  );
}
