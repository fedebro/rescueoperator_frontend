import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

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

const nextConfig: NextConfig = {
  allowedDevOrigins: lanOrigins,
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
