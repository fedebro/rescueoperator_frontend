'use client';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import type { I18nText } from '@/contracts';

/** "FIRE_APS" / "catalog.vehicle.FIRE_APS.name" → "Fire aps" — last resort when neither a message nor a fallback exists. */
export function humanizeKey(key: string): string {
  const parts = key.split('.');
  const last = parts.at(-1) ?? key;
  const code = ['name', 'title', 'description', 'report'].includes(last) ? (parts.at(-2) ?? last) : last;
  const words = code.replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Resolves server-sent translatable text (`{ key, params }`) against the client's messages.
 * Unknown key → `params.fallback` → humanised key. Never throws: content can be newer than the client build.
 */
export function useI18nText(): (text: I18nText | null | undefined) => string {
  const t = useTranslations();
  return React.useCallback(
    (text) => {
      if (!text) return '';
      const fallback = typeof text.params?.fallback === 'string' ? text.params.fallback : null;
      try {
        if (t.has(text.key as never)) return t(text.key as never, (text.params ?? {}) as never);
      } catch {
        /* malformed params for this message → fall through */
      }
      return fallback ?? humanizeKey(text.key);
    },
    [t],
  );
}
