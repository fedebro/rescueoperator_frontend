'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { sameOriginPath } from './deep-link';

/** Message `public/sw.js` posts to a game window when a notification is clicked (same name there). */
export const SW_NAVIGATE_MESSAGE = 'rc:navigate';

/**
 * A notification clicked while a game window is open: the service worker focuses it and posts the link here, and the
 * app navigates client-side (no reload of the whole game). Mounted once at the root.
 */
export function ServiceWorkerNavigation() {
  const router = useRouter();
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const container = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || data.type !== SW_NAVIGATE_MESSAGE) return;
      const path = sameOriginPath(data.url, window.location.origin);
      if (path) router.push(path);
    };
    container.addEventListener('message', onMessage);
    // Messages wait in a queue until the page opts in (or DOMContentLoaded): opt in explicitly.
    container.startMessages?.();
    return () => container.removeEventListener('message', onMessage);
  }, [router]);
  return null;
}
