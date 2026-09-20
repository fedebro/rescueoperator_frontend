import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';

/** Brand colours of `globals.css` (`--rc-surface-1`): the manifest cannot read CSS variables. */
const BRAND_NAVY = '#0A1220';

/**
 * Web app manifest. Texts follow the visitor's locale (cookie / Accept-Language, like every page); the install
 * identity (`id`) is locale-independent so that a language change never looks like a different app.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations('platform.manifest');
  const shortcutIcon = [{ src: '/icons/app/icon-192.png', sizes: '192x192', type: 'image/png' }];
  return {
    id: '/game',
    name: 'Rescue Control',
    short_name: 'Rescue Control',
    description: t('description'),
    start_url: '/game',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: BRAND_NAVY,
    theme_color: BRAND_NAVY,
    categories: ['games', 'simulation', 'strategy'],
    prefer_related_applications: false,
    icons: [
      { src: '/icons/app/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/app/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      { name: t('shortcutMap'), short_name: t('shortcutMap'), url: '/game', icons: shortcutIcon },
      {
        name: t('shortcutIncidents'),
        short_name: t('shortcutIncidents'),
        url: '/game/incidents',
        icons: shortcutIcon,
      },
      { name: t('shortcutFleet'), short_name: t('shortcutFleet'), url: '/game/fleet', icons: shortcutIcon },
    ],
  };
}
