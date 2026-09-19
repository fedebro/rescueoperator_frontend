import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Rescue Control',
    short_name: 'Rescue Control',
    description: 'Emergency management simulator',
    start_url: '/game',
    display: 'standalone',
    background_color: '#0A1220',
    theme_color: '#0A1220',
    orientation: 'any',
    icons: [
      { src: '/icons/app/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/app/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/app/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
