'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Handshake, UserX } from 'lucide-react';
import { allianceApi } from '@/lib/api/alliance';
import { qk } from '@/lib/api/query-keys';
import { mayHaveSession } from '@/lib/api/client';
import { LOCALE_NAMES } from '@/i18n/config';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { Logo } from '@/components/brand/logo';
import { LanguageSelect } from '@/features/settings/language-select';
import { rememberAllianceInvite } from './alliance-screen';
import { Emblem } from './emblem';

const CODE_PATTERN = /^[A-Z0-9]{4,64}$/;

/**
 * Public `/invite/alliance/[code]` (contracts/alliances.ts): "X invites you into [TAG] Name" → the signed-in player lands on
 * the section with the card (`?invite=`), a visitor goes to sign-in and the code waits in this device's storage.
 */
export function AllianceInviteLanding({ code }: { code: string }) {
  const t = useTranslations('alliance.landing');
  const tc = useTranslations('common');
  const wellFormed = CODE_PATTERN.test(code);
  const invite = useQuery({
    queryKey: qk.publicAllianceInvite(code),
    queryFn: () => allianceApi.publicInvite(code),
    enabled: wellFormed,
    retry: false,
  });
  const valid = wellFormed && invite.data?.valid === true && !!invite.data.alliance;
  const signedIn = typeof window !== 'undefined' && mayHaveSession();
  React.useEffect(() => {
    if (valid && !signedIn) rememberAllianceInvite(code);
  }, [valid, signedIn, code]);
  const pending = wellFormed && invite.isLoading;
  const a = invite.data?.alliance ?? null;
  return (
    <main className="h-dvh-safe scroll-y bg-bg">
      <div className="pt-safe pb-safe mx-auto flex min-h-full w-full max-w-md flex-col px-5">
        <header className="flex h-14 shrink-0 items-center justify-between">
          <Logo variant="horizontal" className="w-36" />
          <LanguageSelect compact />
        </header>
        <div
          className="flex flex-1 flex-col justify-center gap-6 py-8"
          data-testid="alliance-invite-landing"
          data-valid={valid}
        >
          {pending ? (
            <Skeleton className="h-40" />
          ) : valid && a ? (
            <>
              <div className="flex items-center gap-4">
                <Emblem emblem={a.emblem} size={72} />
                <div className="min-w-0">
                  <h1 className="font-display text-2xl font-extrabold">
                    {t('title', { name: a.name, tag: a.tag })}
                  </h1>
                  <p className="text-muted text-sm">
                    {invite.data?.invitedBy ? t('by', { name: invite.data.invitedBy }) : null}
                  </p>
                </div>
              </div>
              <p className="text-muted">{a.description || t('pitch')}</p>
              <p className="text-subtle text-sm">
                {t('facts', {
                  level: a.level,
                  members: a.members,
                  slots: a.memberSlots,
                  language: LOCALE_NAMES[a.language],
                })}
              </p>
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
              <Link
                href={
                  valid ? (signedIn ? `/game/alliance?invite=${encodeURIComponent(code)}` : '/auth') : '/auth'
                }
                data-testid="alliance-invite-cta"
              >
                <Handshake className="size-5" aria-hidden />
                {valid ? (signedIn ? t('cta') : t('ctaSignIn')) : t('ctaInvalid')}
              </Link>
            </Button>
          )}
        </div>
        <p className="text-subtle pb-4 text-center text-xs">{tc('disclaimer')}</p>
      </div>
    </main>
  );
}
