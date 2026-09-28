'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';

const FooterSlotContext = React.createContext<HTMLElement | null>(null);

/**
 * The pinned footer of a panel (the inspector's primary action, always visible — also in the sheet's peek state,
 * 03 §2.4). The panel renders an element and provides it here; content deep inside the scrolling body portals itself
 * into it with {@link FooterPortal} while keeping its own state where it lives.
 */
export function FooterSlotProvider({
  element,
  children,
}: {
  element: HTMLElement | null;
  children: React.ReactNode;
}) {
  return <FooterSlotContext.Provider value={element}>{children}</FooterSlotContext.Provider>;
}

/** Renders into the nearest footer slot; inline when there is none (a panel used on its own, unit tests). */
export function FooterPortal({ children }: { children: React.ReactNode }) {
  const element = React.useContext(FooterSlotContext);
  return element ? createPortal(children, element) : <>{children}</>;
}
