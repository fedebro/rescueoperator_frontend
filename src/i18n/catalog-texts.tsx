'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { CatalogI18nBundle, type I18nText, type SupportedLocale } from '@/contracts';
import { api } from '@/lib/api/client';

/**
 * Catalog texts (vehicles, facilities, incidents, roles, courses…) are CONTENT, served by the backend at
 * `GET /public/i18n/catalog/:locale[?v=hash]` and never bundled in the client messages. In mock mode the same bundle is
 * generated from the backend YAML by `pnpm gen:mock-catalog`.
 */
export type CatalogMessages = Record<string, string | string[]>;
const CatalogTextsContext = React.createContext<CatalogMessages>({});
/** The bundle has arrived — or failed for good: texts computed once (a toast) can be resolved now or never. */
const CatalogReadyContext = React.createContext(true);

export function CatalogTextsProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocale() as SupportedLocale;
  const bundle = useQuery({
    queryKey: ['catalog-i18n', locale],
    queryFn: () => api.get(`/public/i18n/catalog/${locale}`, { schema: CatalogI18nBundle, auth: false }),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  const messages = bundle.data?.messages ?? EMPTY;
  return (
    <CatalogReadyContext.Provider value={bundle.isSuccess || bundle.isError}>
      <CatalogTextsContext.Provider value={messages}>{children}</CatalogTextsContext.Provider>
    </CatalogReadyContext.Provider>
  );
}
const EMPTY: CatalogMessages = {};
export const useCatalogMessages = (): CatalogMessages => React.useContext(CatalogTextsContext);
/**
 * False while the catalog texts are on their way. React output re-renders when they arrive; a text computed ONCE (a toast
 * raised by a realtime event) would keep its fallback — the game runtime waits for this before listening to events.
 */
export const useCatalogReady = (): boolean => React.useContext(CatalogReadyContext);
/** Test helper / storybook: inject a bundle without fetching. */
export const CatalogTextsOverride = CatalogTextsContext.Provider;

/** Keys used by older payloads / the client message files → key inside the catalog bundle. */
export function catalogKeyAliases(key: string): string[] {
  const out = [key];
  if (key.startsWith('incidents.')) out.push(`incident.${key.slice('incidents.'.length)}`);
  if (key.startsWith('facilityType.')) out.push(`facility.${key.slice('facilityType.'.length)}`);
  if (key.startsWith('catalog.')) {
    const rest = key.slice('catalog.'.length);
    out.push(rest);
    // catalog.family.FIRE / catalog.capability.X carry no field in the client files
    if (/^(family|capability|ung|role|qualification|item)\.[A-Z0-9_]+$/.test(rest)) out.push(`${rest}.name`);
  }
  return out;
}

const fill = (template: string, params: I18nText['params']): string =>
  template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const value = params?.[name];
    return value === undefined || value === null ? m : String(value);
  });

const BLOCKS = [
  ['intros', 'intro'],
  ['details', 'detail'],
  ['conditions', 'condition'],
  ['closings', 'closing'],
] as const;

/**
 * Resolves a server text against the catalog bundle. Incident reports are block-composed:
 * `incident.<CODE>.report` + params `{intro, detail, condition, closing}` (indexes) + `{address, municipality}`.
 */
export function resolveCatalogText(messages: CatalogMessages, text: I18nText): string | null {
  for (const key of catalogKeyAliases(text.key)) {
    const direct = messages[key];
    if (typeof direct === 'string') return fill(direct, text.params);
    if (Array.isArray(direct)) {
      const index = Number(text.params?.index ?? 0);
      const picked = direct[Math.abs(index) % direct.length];
      if (picked !== undefined) return fill(picked, text.params);
    }
    const parts: string[] = [];
    for (const [block, param] of BLOCKS) {
      const options = messages[`${key}.${block}`];
      if (!Array.isArray(options) || options.length === 0) continue;
      const raw = Number(text.params?.[param] ?? 0);
      const index = Number.isFinite(raw) ? Math.abs(Math.trunc(raw)) % options.length : 0;
      parts.push(fill(options[index]!, text.params));
    }
    if (parts.length) return parts.join(' ');
  }
  return null;
}
