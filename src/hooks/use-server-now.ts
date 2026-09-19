'use client';
import * as React from 'react';
import { serverNow } from '@/lib/clock';

/** Re-renders every `intervalMs` with the current SERVER time (device time + tracked offset). */
export function useServerNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = React.useState(() => serverNow());
  React.useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}
