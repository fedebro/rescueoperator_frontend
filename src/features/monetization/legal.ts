/**
 * Legal documents live on the marketing site (`/{locale}/legal/{doc}`), not in the game client.
 * `NEXT_PUBLIC_LANDING_URL` overrides the production origin (e.g. http://localhost:3100 locally).
 */
const LANDING_URL = (process.env.NEXT_PUBLIC_LANDING_URL ?? 'https://rescuecontrol.com').replace(/\/+$/, '');

export const legalUrl = (doc: 'terms' | 'privacy', locale: string): string =>
  `${LANDING_URL}/${locale}/legal/${doc}`;
