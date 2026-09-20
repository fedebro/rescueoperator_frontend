import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WifiOff } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { buttonVariants } from '@/components/ui/button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform.offline');
  return { title: t('title') };
}

/**
 * Offline shell. `public/sw.js` precaches this page (and the assets it links) and serves it when a navigation fails.
 * It must work WITHOUT JavaScript (its chunks may not be cached): retry is a plain GET form that reloads the URL
 * the player was trying to open, the logo is a static file that the worker precaches.
 */
export default async function OfflinePage() {
  const t = await getTranslations('platform.offline');
  return (
    <main
      id="main"
      data-testid="offline-page"
      className="h-dvh-safe bg-bg grid place-items-center p-6 text-center"
    >
      <div className="flex max-w-sm flex-col items-center gap-4">
        <Logo variant="stacked" className="w-42" priority />
        <span aria-hidden className="bg-surface-3 text-warning grid size-12 place-items-center rounded-full">
          <WifiOff className="size-6" />
        </span>
        <h1 className="font-display text-2xl font-extrabold">{t('title')}</h1>
        <p className="text-muted text-sm">{t('body')}</p>
        <form method="get">
          <button type="submit" className={buttonVariants({ size: 'lg' })}>
            {t('retry')}
          </button>
        </form>
        <p className="text-muted text-xs">{t('safe')}</p>
      </div>
    </main>
  );
}
