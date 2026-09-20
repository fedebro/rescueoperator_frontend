import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Standalone build: the Docker image ships only the server bundle it actually needs.
  output: 'standalone',
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
