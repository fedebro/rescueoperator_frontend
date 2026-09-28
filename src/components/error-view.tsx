'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** Shared body of the route error boundaries. */
export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errorBoundary');
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div
      className="grid h-full min-h-[60dvh] place-items-center p-6 text-center"
      role="alert"
      data-testid="error-boundary"
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <h1 className="font-display text-2xl font-extrabold">{t('title')}</h1>
        <p className="text-muted text-sm">{t('body')}</p>
        {error.digest ? <code className="text-subtle text-xs">{error.digest}</code> : null}
        <div className="mt-2 flex gap-2">
          <Button onClick={reset}>{t('retry')}</Button>
          <Button asChild variant="secondary">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full document reload is intended after a crash */}
            <a href="/">{t('home')}</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
