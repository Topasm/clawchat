import { useEffect, useState } from 'react';

/**
 * Where an overlay should portal to.
 *
 * Theme colours are inline custom properties on `.cc-root` (see Layout), so a
 * portal straight into `document.body` renders with the stylesheet's light
 * fallbacks: a white dialog in a dark app. Portal into the root instead; outside
 * Layout (login, settings shell) there is none and the body is right.
 */
export default function useThemedPortalContainer(): HTMLElement | undefined {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setContainer(document.querySelector<HTMLElement>('.cc-root'));
  }, []);
  return container ?? undefined;
}
