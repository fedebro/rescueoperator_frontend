'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Gift, UserX } from 'lucide-react';
import { monetizationApi } from '@/lib/api/depth';
import { track } from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { Logo } from '@/components/brand/logo';
import { LanguageSelect } from '@/features/settings/language-select';
import { isValidInviteCode, rememberInviteCode } from './invite-code';

/**
 * Public `/invite/[code]`: "X invited you" → CTA to sign-up. The code is remembered on this device and attached to the
 * sign-up (see invite-code.ts). An unknown code still lets the visitor play — just without the bonus.
 */
export function InviteLanding({ code }: { code: string }) {
  const t = useTranslations('monetization.invite');
  const tc = useTranslations('common');
  const wellFormed = isValidInviteCode(code);
  const invite = useQuery({
    queryKey: ['public', 'invite', code],
    queryFn: () => monetizationApi.publicInvite(code),
    enabled: wellFormed,
    retry: false,
  });
  const valid = wellFormed && invite.data?.valid === true;
  React.useEffect(() => {
    if (!valid) return;
    rememberInviteCode(code);
    track('invite_landing_viewed', { valid: true });
  }, [valid, code]);
  const pending = wellFormed && invite.isLoading;

  return (
    <main className="h-dvh-safe scroll-y bg-bg">
      <div className="pt-safe pb-safe mx-auto flex min-h-full w-full max-w-md flex-col px-5">
        <header className="flex h-14 shrink-0 items-center justify-between">
          <Logo variant="horizontal" className="w-36" />
          <LanguageSelect compact />
        </header>
        <div
          className="flex flex-1 flex-col justify-center gap-6 py-8"
          data-testid="invite-landing"
          data-valid={valid}
        >
          {pending ? (
            <Skeleton className="h-40" />
          ) : valid ? (
            <>
              <Gift className="text-credits size-12" aria-hidden />
              <div>
                <h1 className="font-display text-3xl font-extrabold">
                  {t('title', { name: invite.data?.directorName ?? '' })}
                </h1>
                <p className="text-muted mt-3">{t('pitch')}</p>
                <p className="text-muted mt-2 text-sm">{t('bonus')}</p>
              </div>
            </>
          ) : (
            <>
              <UserX className="text-muted size-12" aria-hidden />
              <div>
                <h1 className="font-display text-3xl font-extrabold">{t('invalidTitle')}</h1>
                <p className="text-muted mt-3">{t('invalidHint')}</p>
              </div>
            </>
          )}
          {pending ? null : (
            <Button asChild size="xl">
              <Link href="/auth" data-testid="invite-cta">
                {valid ? t('cta') : t('ctaInvalid')}
              </Link>
            </Button>
          )}
        </div>
        <p className="text-subtle pb-4 text-center text-[11px]">{tc('disclaimer')}</p>
      </div>
    </main>
  );
}
