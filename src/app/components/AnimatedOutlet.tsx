import { useEffect, useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';

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

  if (isMobile) {
    return <>{outlet}</>;
  }

  // Keyed by path so each route replays the CSS fade-in. The next route shows
  // as soon as it renders instead of waiting for the previous one to fade out.
  return (
    <div key={location.pathname} className="cc-route-transition">
      {outlet}
    </div>
  );
}
