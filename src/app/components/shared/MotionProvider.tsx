import type { ReactNode } from 'react';
import { LazyMotion } from 'framer-motion';

const loadMotionFeatures = () => import('./motionFeatures').then((module) => module.default);

/**
 * Animated components use the lightweight `m` elements; the animation features
 * arrive in their own chunk after first paint instead of with the app shell.
 */
export default function MotionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={loadMotionFeatures}>{children}</LazyMotion>;
}
