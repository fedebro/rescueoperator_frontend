'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/button';

/**
 * Attributes of an inspector header: in the phone bottom sheet it is a drag handle (the whole header, 02 §3.1) and it
 * ends the peek state (the peek shows the header + the pinned footer, nothing else). Shared by every inspector — the
 * game's own and the ones living in feature folders (hospital, candidate site).
 */
export const SHEET_HEADER = { 'data-sheet-drag': '', 'data-sheet-peek-end': '' } as const;

/** 44×44 icon buttons of an inspector header (close, centre on the map): the only way back must be easy to hit. */
export function InspectorHeaderButton(props: React.ComponentProps<typeof IconButton>) {
  return <IconButton size="sm" {...props} className={cn('size-11 shrink-0', props.className)} />;
}
