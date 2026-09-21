'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Clock, Lock, Minus, Plus, RefreshCw, UserPlus, UserSearch } from 'lucide-react';
import type { FacilityDto } from '@/contracts';
import { personnelApi } from '@/lib/api/depth';
import { track } from '@/lib/analytics';
import { compareAmount, formatClock } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { FamilyBadge } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { SpeedupButton } from '@/features/monetization/speedup-button';
import { requestCredits } from '@/features/monetization/insufficient-credits';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { freeBeds } from './operator-sheet';
import { PotentialBadge } from './status';
import {
  useCandidates,
  useCommandError,
  useInvalidatePersonnel,
  usePersonnel,
  useRoles,
  type Candidate,
  type RoleInfo,
} from './queries';

const MAX_QUICK_HIRE = 10;
const hosts = (facility: FacilityDto, family: string): boolean =>
  facility.status === 'OPERATIONAL' &&
  (family === 'SHARED' || facility.family === 'SHARED' || facility.family === family);

export function RecruitmentTab({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <QuickHire onSelect={onSelect} />
      <CandidatesMarket />
    </div>
  );
}

function QuickHire({ onSelect }: { onSelect: (id: string) => void }) {
  const careerId = useCareerId();
  const t = useTranslations('personnel.hire');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const { career, facilities } = useSnapshot();
  const roles = useRoles().filter((r) => r.quickHire);
  const people = usePersonnel().data ?? [];
  const invalidate = useInvalidatePersonnel();
  const onError = useCommandError();
  const [roleCode, setRoleCode] = React.useState<string>();
  const [facilityId, setFacilityId] = React.useState<string>();
  const [count, setCount] = React.useState(1);

  const isOpen = (r: RoleInfo) =>
    r.requiredLevel <= career.level &&
    (r.family === 'SHARED' || career.unlockedFamilies.some((f) => f === r.family));
  const role = roles.find((r) => r.code === roleCode) ?? roles.find(isOpen);
  const compatible = role ? facilities.filter((f) => hosts(f, role.family)) : [];
  const facility = compatible.find((f) => f.id === facilityId) ?? compatible[0];
  const beds = facility ? freeBeds(facility) : 0;
  const total = role ? BigInt(Math.round(role.hireCost)) * BigInt(count) : 0n;
  const onboarding = people.filter((p) => p.status === 'ONBOARDING');

  const hire = useMutation({
    mutationFn: (v: { roleCode: string; facilityId: string; count: number }) =>
      personnelApi.quickHire(careerId, v),
    onSuccess: (hired, v) => {
      track('personnel_hired', { kind: 'QUICK', roleCode: v.roleCode, count: hired.length });
      toast({ tone: 'success', title: t('hired', { count: hired.length }) });
      setCount(1);
      void invalidate();
    },
    onError: (e) => onError(e, total),
  });
  const submit = () => {
    if (!role || !facility) return;
    if (compareAmount(career.credits, total) < 0) requestCredits(total);
    else hire.mutate({ roleCode: role.code, facilityId: facility.id, count });
  };

  return (
    <section className="flex flex-col gap-3" data-testid="quick-hire">
      <div>
        <h2 className="font-display text-lg font-bold">{t('title')}</h2>
        <p className="text-muted text-sm">{t('subtitle')}</p>
      </div>
      <Card className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted text-xs font-semibold tracking-wide uppercase">{t('role')}</span>
            <Select
              label={t('role')}
              value={role?.code}
              onValueChange={setRoleCode}
              options={roles.map((r) => ({
                value: r.code,
                label: isOpen(r)
                  ? name('role', r.code)
                  : `${name('role', r.code)} · ${tc('requiresLevel', { level: r.requiredLevel })}`,
                disabled: !isOpen(r),
              }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted text-xs font-semibold tracking-wide uppercase">{t('facility')}</span>
            <Select
              label={t('facility')}
              value={facility?.id}
              onValueChange={setFacilityId}
              placeholder={t('noFacility')}
              options={compatible.map((f) => ({
                value: f.id,
                label: `${f.name} · ${t('beds', { count: freeBeds(f) })}`,
              }))}
            />
          </div>
        </div>
        {role ? (
          <p className="text-muted text-sm">
            {name('role', role.code, 'description')}{' '}
            <span className="text-subtle">
              {t('roleFacts', {
                cost: role.costPerPeriod,
                onboarding: formatClock(role.onboardingSeconds),
              })}
            </span>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1" role="group" aria-label={t('count')}>
              <IconButton
                label={t('fewer')}
                variant="secondary"
                onClick={() => setCount((c) => Math.max(1, c - 1))}
                disabled={count <= 1}
              >
                <Minus className="size-4" aria-hidden />
              </IconButton>
              <output className="tabular w-10 text-center text-lg font-bold" data-testid="hire-count">
                {count}
              </output>
              <IconButton
                label={t('more')}
                variant="secondary"
                onClick={() => setCount((c) => Math.min(MAX_QUICK_HIRE, Math.max(1, beds), c + 1))}
                disabled={count >= Math.min(MAX_QUICK_HIRE, beds)}
              >
                <Plus className="size-4" aria-hidden />
              </IconButton>
            </div>
            {facility ? (
              <span
                className="text-subtle tabular text-center text-[11px]"
                aria-live="polite"
                data-testid="hire-beds-remaining"
              >
                {t('beds', { count: Math.max(0, beds - count) })}
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <span className="text-subtle block text-[11px] font-semibold tracking-wide uppercase">
              {t('total')}
            </span>
            <CreditAmount value={total.toString()} label={tc('credits')} />
          </div>
          <Button
            onClick={submit}
            loading={hire.isPending}
            disabled={!role || !facility || beds < count}
            data-testid="quick-hire-submit"
            className="max-sm:w-full"
          >
            <UserPlus className="size-4" aria-hidden />
            {t('submit', { count })}
          </Button>
        </div>
        {facility && beds < count ? (
          <p className="text-warning flex items-center gap-1.5 text-xs" role="status">
            <Lock className="size-3.5" aria-hidden />
            {t('noBeds')}
          </p>
        ) : null}
      </Card>

      {onboarding.length > 0 ? (
        <div>
          <SectionTitle>{t('onboarding')}</SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {onboarding.map((p) => (
              <li
                key={p.id}
                className="bg-surface-2 border-border flex flex-wrap items-center gap-2 rounded-md border p-2.5"
                data-testid="onboarding-row"
              >
                <FamilyBadge family={p.family} size={24} title={name('family', p.family)} />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline"
                  onClick={() => onSelect(p.id)}
                  title={`${p.firstName} ${p.lastName} · ${name('role', p.roleCode)}`}
                >
                  {p.firstName} {p.lastName}
                  <span className="text-muted font-normal"> · {name('role', p.roleCode)}</span>
                </button>
                <Countdown
                  to={p.busyUntil}
                  doneLabel={tc('arriving')}
                  prefix={<Clock className="size-3.5" aria-hidden />}
                  className="text-sm"
                />
                <SpeedupButton
                  target="ONBOARDING"
                  targetId={p.id}
                  endsAt={p.busyUntil}
                  size="sm"
                  onDone={() => void invalidate()}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CandidatesMarket() {
  const careerId = useCareerId();
  const t = useTranslations('personnel.market');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const { career, facilities } = useSnapshot();
  const market = useCandidates();
  const invalidate = useInvalidatePersonnel();
  const onError = useCommandError();
  const [facilityByCandidate, setFacilityByCandidate] = React.useState<Record<string, string>>({});

  const hire = useMutation({
    mutationFn: (v: { candidate: Candidate; facilityId: string }) =>
      personnelApi.hireCandidate(careerId, v.candidate.id, v.facilityId),
    onSuccess: (_r, v) => {
      track('personnel_hired', {
        kind: 'CANDIDATE',
        roleCode: v.candidate.roleCode,
        potential: v.candidate.potential,
      });
      toast({ tone: 'success', title: t('hired', { name: v.candidate.firstName }) });
      void invalidate();
    },
    onError: (e, v) => onError(e, v.candidate.hireCost),
  });

  return (
    <section className="flex flex-col gap-3" data-testid="candidates-market">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold">{t('title')}</h2>
          <p className="text-muted text-sm">{t('subtitle')}</p>
        </div>
        {market.data ? (
          <Countdown
            to={market.data.nextRefreshAt}
            doneLabel={tc('arriving')}
            prefix={
              <>
                <RefreshCw className="size-3.5" aria-hidden />
                <span className="text-subtle text-xs">{t('nextRefresh')}</span>
              </>
            }
            className="text-sm font-semibold"
          />
        ) : null}
      </div>
      {!market.data ? (
        <Skeleton className="h-40" />
      ) : market.data.candidates.length === 0 ? (
        <EmptyState
          icon={<UserSearch className="size-5" />}
          title={t('emptyTitle')}
          description={t('emptyHint')}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {market.data.candidates.map((c) => {
            const compatible = facilities.filter((f) => hosts(f, c.family) && freeBeds(f) > 0);
            const facilityId = facilityByCandidate[c.id] ?? compatible[0]?.id;
            const onHire = () => {
              if (!facilityId) return;
              if (compareAmount(career.credits, c.hireCost) < 0) requestCredits(c.hireCost);
              else hire.mutate({ candidate: c, facilityId });
            };
            return (
              <li key={c.id}>
                <Card className="flex h-full flex-col gap-3" data-testid="candidate-card">
                  <div className="flex items-center gap-2.5">
                    <FamilyBadge family={c.family} size={32} title={name('family', c.family)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" title={`${c.firstName} ${c.lastName}`}>
                        {c.firstName} {c.lastName}
                      </p>
                      <p className="text-muted truncate text-xs" title={name('role', c.roleCode)}>
                        {name('role', c.roleCode)}
                      </p>
                    </div>
                    <PotentialBadge potential={c.potential} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="neutral">{t('competence', { value: c.competence })}</Badge>
                    {c.qualifications.map((q) => (
                      <Badge key={q} tone="info">
                        {name('qualification', q)}
                      </Badge>
                    ))}
                  </div>
                  <dl className="text-muted grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-subtle">{t('hireCost')}</dt>
                      <dd>
                        <CreditAmount value={c.hireCost} label={tc('credits')} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-subtle">{t('costPerPeriod')}</dt>
                      <dd>
                        <CreditAmount value={c.costPerPeriod} label={tc('credits')} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-subtle">{t('expires')}</dt>
                      <dd>
                        <Countdown
                          to={c.expiresAt}
                          doneLabel={t('expired')}
                          className="text-fg font-semibold"
                        />
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-auto flex gap-2">
                    <Select
                      label={t('facility')}
                      value={facilityId}
                      onValueChange={(v) => setFacilityByCandidate((m) => ({ ...m, [c.id]: v }))}
                      placeholder={t('noFacility')}
                      options={compatible.map((f) => ({ value: f.id, label: f.name }))}
                      className="min-w-0 flex-1"
                    />
                    <Button
                      onClick={onHire}
                      disabled={!facilityId}
                      loading={hire.isPending && hire.variables?.candidate.id === c.id}
                      data-testid="hire-candidate"
                    >
                      <UserPlus className="size-4" aria-hidden />
                      {t('hire')}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-subtle text-xs">{t('fairness')}</p>
    </section>
  );
}
