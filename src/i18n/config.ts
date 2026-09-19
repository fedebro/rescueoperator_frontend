import type { SupportedLocale } from '@/contracts';

export const LOCALES: readonly SupportedLocale[] = ['it', 'en', 'fr', 'de', 'es'];
export const DEFAULT_LOCALE: SupportedLocale = 'it';
export const LOCALE_COOKIE = 'rc_locale';
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  it: 'Italiano',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
};

export const isLocale = (value: string | undefined | null): value is SupportedLocale =>
  !!value && (LOCALES as readonly string[]).includes(value);

/** Picks the best supported locale from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): SupportedLocale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', q] = part.trim().split(';q=');
      return { lang: tag.toLowerCase().split('-')[0] ?? '', q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) if (isLocale(lang)) return lang;
  return DEFAULT_LOCALE;
}
