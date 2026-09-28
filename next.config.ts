import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { resolveReleaseId } from './src/features/push/release-id';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Next's dev server refuses cross-origin requests by default (a real browser's `fetch`/navigation to any origin not
 * in this list gets a bare connection failure, not a 403 body — curl doesn't send the headers that trigger the
 * check, so it looked fine from the shell while every other device on the LAN got stuck on the splash screen).
 * Computed from the machine's own interfaces at dev-server startup instead of a hardcoded IP, since DHCP can hand
 * out a different address on the next reconnect.
 */
const lanOrigins = Object.values(networkInterfaces())
  .flat()
  .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);

/**
 * Release id (D-98): every build is a new release, and each release asks — once — every device that has not enabled
 * push notifications yet. Nothing to set at deploy time: the build timestamp (`20260928T170211Z`) is the default;
 * `RELEASE_ID` pins it (a CI tag, a rebuild of the same release). Written back into `process.env` so that every process
 * of the same build (Next spawns workers that re-read this file) inlines one and the same value.
 */
const releaseId = (process.env.RELEASE_ID = resolveReleaseId(process.env));

const nextConfig: NextConfig = {
  allowedDevOrigins: lanOrigins,
  env: { NEXT_PUBLIC_RELEASE_ID: releaseId },
  // Standalone build: the Docker image ships only the server bundle it actually needs.
  output: 'standalone',
  /**
   * `NEXT_PUBLIC_*` is inlined at build time, so the mock e2e suite (API_MOCK=1) and the real-backend suite
   * (API_MOCK=0) need two different builds. A separate output directory lets both exist side by side instead of
   * overwriting each other's `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [
      {
        source: '/mockServiceWorker.js',
        headers: [{ key: 'Service-Worker-Allowed', value: '/' }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
