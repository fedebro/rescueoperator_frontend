import { env } from '@/lib/env';

export type AdminEnvironment = 'LOCAL' | 'MOCK' | 'STAGING' | 'PRODUCTION';
const KNOWN: readonly string[] = ['LOCAL', 'MOCK', 'STAGING', 'PRODUCTION'];

/**
 * Which environment this admin talks to (Spec 18 §40). Order of trust: the API's own answer (`GET /version` →
 * `environment`), then `NEXT_PUBLIC_APP_ENV`, then a guess from the API origin. An unknown origin counts as
 * PRODUCTION on purpose: the safe mistake is to warn too much.
 */
export function resolveEnvironment(
  fromApi: string | null | undefined,
  options: { apiMock: boolean; apiUrl: string; appEnv?: string } = {
    apiMock: env.apiMock,
    apiUrl: env.apiUrl,
    appEnv: process.env.NEXT_PUBLIC_APP_ENV,
  },
): AdminEnvironment {
  if (options.apiMock) return 'MOCK';
  for (const candidate of [fromApi, options.appEnv]) {
    const value = candidate?.trim().toUpperCase();
    if (value && KNOWN.includes(value)) return value as AdminEnvironment;
    if (value === 'DEVELOPMENT' || value === 'DEV' || value === 'TEST') return 'LOCAL';
    if (value === 'PROD') return 'PRODUCTION';
  }
  let host = '';
  try {
    host = new URL(options.apiUrl).hostname;
  } catch {
    return 'PRODUCTION';
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local'))
    return 'LOCAL';
  if (/(^|[.-])(staging|stage|stg|preview)([.-]|$)/.test(host)) return 'STAGING';
  return 'PRODUCTION';
}
