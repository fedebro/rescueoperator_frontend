import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
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
