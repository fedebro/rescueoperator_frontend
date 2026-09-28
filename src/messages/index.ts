import type { SupportedLocale } from '@/contracts';

/**
 * Messages = the core file `<locale>.json` + one file per feature area in `parts/<locale>/<part>.json`
 * (deep-merged; a part may extend an existing namespace such as `status` or `errors`).
 * Every part exists for all five locales — `pnpm check:i18n` verifies key and placeholder parity on the merged tree.
 */
export const MESSAGE_PARTS = [
  'families',
  'facilities',
  'personnel',
  'medical',
  'logistics',
  'world',
  'monetization',
  'notifications',
  'platform',
  'admin',
  'coaching',
  'water',
  'autonomy',
  'nautical',
  'maxi',
] as const;

export type MessageTree = { [key: string]: MessageTree | string };

export function mergeMessages(base: MessageTree, extra: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = out[key];
    out[key] =
      typeof value === 'object' && typeof current === 'object' ? mergeMessages(current, value) : value;
  }
  return out;
}

export async function loadMessages(locale: SupportedLocale): Promise<MessageTree> {
  const [base, ...parts] = await Promise.all([
    import(`./${locale}.json`) as Promise<{ default: MessageTree }>,
    ...MESSAGE_PARTS.map(
      (part) => import(`./parts/${locale}/${part}.json`) as Promise<{ default: MessageTree }>,
    ),
  ]);
  return parts.reduce((acc, p) => mergeMessages(acc, p.default), base.default);
}
