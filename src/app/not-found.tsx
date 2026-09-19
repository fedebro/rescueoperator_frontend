import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/brand/logo';
import { buttonVariants } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <main className="h-dvh-safe bg-bg grid place-items-center p-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-4">
        <Logo variant="horizontal" className="w-44" />
        <p className="tabular text-brand text-6xl font-bold">404</p>
        <h1 className="font-display text-2xl font-extrabold">{t('title')}</h1>
        <p className="text-muted">{t('body')}</p>
        <Link href="/" className={buttonVariants({ size: 'lg' })}>
          {t('back')}
        </Link>
      </div>
    </main>
  );
}
