'use client';
import * as React from 'react';

/**
 * Radix Dialog only restores focus to its own `<Dialog.Trigger>`. Most of our dialogs and drawers are CONTROLLED
 * (opened from a store, a toast, a row click…), so there is no trigger and focus would be lost to `<body>` on close —
 * a keyboard user would restart from the top of the page. This remembers what had focus when the content mounted
 * and gives it back on close.
 */
export function useRestoreFocus(): (event: Event) => void {
  // Lazy initialiser = during the first render of the content, i.e. before Radix's FocusScope moves focus inside.
  const [previous] = React.useState<Element | null>(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  );
  return React.useCallback(
    (event: Event) => {
      if (event.defaultPrevented) return;
      if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) {
        event.preventDefault();
        previous.focus();
      }
    },
    [previous],
  );
}
