'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowUpCircle, CheckCircle2, Circle, Hammer, Lock } from 'lucide-react';
import type { FacilityDetailV2Dto, FacilityDto } from '@/contracts';
import { facilitiesApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { track } from '@/lib/analytics';
import { compareAmount, formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Card, SectionTitle } from '@/components/ui/misc';
import { SpeedupButton } from '@/features/monetization/speedup-button';
import { requestCredits } from '@/features/monetization/insufficient-credits';
import { useCareerId, useSnapshot } from '@/features/game/hooks';

type PromotionOffer = NonNullable<FacilityDetailV2Dto['promotionOffer']>;

/** UNDER_CONSTRUCTION facility: countdown to `operationalAt` + "finish now" (managerial timer → speed-up allowed). */
export function ConstructionBanner({ facility, className }: { facility: FacilityDto; className?: string }) {
  const t = useTranslations('facilities.construction');
  if (facility.status !== 'UNDER_CONSTRUCTION') return null;
  return (
    <div
      className={cn(
        'border-warning/40 bg-warning/10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2.5 text-sm',
        className,
      )}
      role="status"
      data-testid="construction-banner"
    >
      <Hammer className="text-warning size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{t('title')}</span>
        <span className="text-muted block text-xs">{t('hint')}</span>
      </span>
      {facility.operationalAt ? (
        <>
          <Countdown
            to={facility.operationalAt}
            doneLabel="…"
            prefix={<span className="sr-only">{t('readyIn')}</span>}
          />
          <SpeedupButton
            target="FACILITY_UPGRADE"
            targetId={facility.id}
            endsAt={facility.operationalAt}
            size="sm"
          />
        </>
      ) : null}
    </div>
  );
}

/** What each requirement of the promotion asks for and whether the facility already meets it. */
export function promotionChecklist(
  offer: Pick<PromotionOffer, 'requiredLevel' | 'requiredUpgradeLevels'>,
  facility: Pick<FacilityDto, 'upgrades'>,
  careerLevel: number,
): { kind: 'LEVEL' | 'UPGRADE'; code: string; required: number; current: number; met: boolean }[] {
  return [
    {
      kind: 'LEVEL' as const,
      code: 'LEVEL',
      required: offer.requiredLevel,
      current: careerLevel,
      met: careerLevel >= offer.requiredLevel,
    },
    ...Object.entries(offer.requiredUpgradeLevels).map(([code, required]) => {
      const current = facility.upgrades.find((u) => u.code === code)?.level ?? 0;
      return { kind: 'UPGRADE' as const, code, required, current, met: current >= required };
    }),
  ];
}

/** Promotion of the facility to the next type of its chain: requirements checklist, price, build timer. */
export function PromotionCard({
  facility,
  offer,
}: {
  facility: FacilityDto;
  offer: PromotionOffer | null | undefined;
}) {
  const careerId = useCareerId();
  const t = useTranslations('facilities.promotion');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const name = useCatalogName();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const { career } = useSnapshot();
  const promote = useMutation({
    mutationFn: () => facilitiesApi.promote(careerId, facility.id),
    onSuccess: () => {
      track('facility_promotion_started', { from: facility.typeCode, to: offer?.toTypeCode ?? '' });
      toast({ tone: 'success', title: t('started') });
      void qc.invalidateQueries({ queryKey: qk.facility(careerId, facility.id) });
    },
    onError: (e) => {
      if (isApiError(e, 'INSUFFICIENT_CREDITS')) requestCredits(offer?.price ?? '0');
      else toast({ tone: 'danger', title: errorMessage(e) });
    },
  });
  if (!offer && !facility.promotion) {
    return (
      <Card data-testid="promotion-card" data-state="TOP">
        <SectionTitle>{t('title')}</SectionTitle>
        <p className="text-muted flex items-center gap-2 text-sm">
          <CheckCircle2 className="text-success size-4" aria-hidden />
          {t('topOfChain')}
        </p>
      </Card>
    );
  }
  const toTypeCode = facility.promotion?.toTypeCode ?? offer?.toTypeCode ?? '';
  const targetName = offer ? tx(offer.name) : name('facility', toTypeCode);
  const tooPoor = offer ? compareAmount(career.credits, offer.price) < 0 : false;
  return (
    <Card
      data-testid="promotion-card"
      data-state={facility.promotion ? 'BUILDING' : offer?.available ? 'READY' : 'LOCKED'}
    >
      <SectionTitle>{t('title')}</SectionTitle>
      <div className="flex items-start gap-3">
        <ArrowUpCircle className="text-info mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {name('facility', facility.typeCode)} → {targetName}
          </p>
          <p className="text-muted text-xs">{t('hint')}</p>
        </div>
      </div>
      {facility.promotion ? (
        <p className="text-warning mt-3 flex flex-wrap items-center gap-2 text-sm" role="status">
          <Hammer className="size-4" aria-hidden />
          {t('building')}
          <Countdown to={facility.promotion.completeAt} doneLabel="…" />
          <SpeedupButton
            target="FACILITY_UPGRADE"
            targetId={facility.id}
            endsAt={facility.promotion.completeAt}
            size="sm"
            className="ml-auto"
          />
        </p>
      ) : offer ? (
        <>
          <ul className="mt-3 flex flex-col gap-1.5" aria-label={t('requirements')}>
            {promotionChecklist(offer, facility, career.level).map((item) => (
              <li
                key={item.code}
                className={cn('flex items-center gap-2 text-xs', item.met ? 'text-success' : 'text-muted')}
                data-testid="promotion-requirement"
                data-met={item.met}
              >
                {item.met ? (
                  <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <Circle className="size-3.5 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  {item.kind === 'LEVEL'
                    ? t('needLevel', { level: item.required })
                    : t('needUpgrade', { upgrade: name('upgrade', item.code), level: item.required })}
                </span>
                <span className="tabular">
                  {item.current}/{item.required}
                </span>
                <span className="sr-only">{item.met ? t('met') : t('missing')}</span>
              </li>
            ))}
          </ul>
          {offer.available ? (
            <Button
              variant={tooPoor ? 'outline' : 'primary'}
              className="mt-3 w-full justify-between sm:w-auto sm:min-w-72"
              loading={promote.isPending}
              onClick={() => (tooPoor ? requestCredits(offer.price) : promote.mutate())}
              data-testid="promote-facility"
            >
              <span>
                {t('promote')} · {formatClock(offer.buildSeconds)}
              </span>
              <CreditAmount value={offer.price} label={tc('credits')} tone={tooPoor ? 'credits' : 'plain'} />
            </Button>
          ) : (
            <p className="border-border-strong text-muted mt-3 flex min-h-10 items-center justify-between gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs">
              <span className="flex items-center gap-1.5">
                <Lock className="size-3.5 shrink-0" aria-hidden />
                {offer.lockedReason === 'LEVEL_TOO_LOW'
                  ? tc('requiresLevel', { level: offer.requiredLevel })
                  : offer.lockedReason === 'UPGRADE_IN_PROGRESS'
                    ? t('waitUpgrades')
                    : offer.lockedReason === 'FACILITY_NOT_OPERATIONAL'
                      ? t('notOperational')
                      : t('needUpgrades')}
              </span>
              <CreditAmount value={offer.price} label={tc('credits')} size="sm" tone="plain" />
            </p>
          )}
        </>
      ) : null}
    </Card>
  );
}
