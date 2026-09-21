'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeftRight, BedDouble, GraduationCap, HeartPulse, Hourglass, UserMinus } from 'lucide-react';
import type { FacilityDto, I18nText, PersonnelDto } from '@/contracts';
import { personnelApi } from '@/lib/api/depth';
import { track } from '@/lib/analytics';
import { formatAmount, formatDateTime } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useServerNow } from '@/hooks/use-server-now';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { FamilyBadge } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { SectionTitle, Skeleton, Stat } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Timeline } from '@/components/ui/timeline';
import { SpeedupButton } from '@/features/monetization/speedup-button';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { fatigueAt } from './fatigue';
import { FatigueGauge } from './fatigue-gauge';
import { PersonnelStatusChip } from './status';
import {
  useCommandError,
  useFeature,
  useInvalidatePersonnel,
  usePersonnelDetail,
  useTeams,
  useTraining,
  type Course,
} from './queries';

const SPEEDUP_TARGET = { REST: 'REST', ONBOARDING: 'ONBOARDING', TRAINING: 'TRAINING' } as const;
const isIdle = (op: PersonnelDto) => op.status === 'AVAILABLE' || op.status === 'ASSIGNED';
const MIN_FATIGUE_TO_REST = 5;

export const freeBeds = (facility: FacilityDto): number => {
  const row = facility.capacities.find((c) => c.domain === 'PERSONNEL');
  return row ? Math.max(0, row.total - row.used) : 0;
};

/** Courses this operator can attend right now (role, prerequisites, not already qualified, unlocked). */
export function eligibleCourses(op: PersonnelDto, courses: Course[]): Course[] {
  const held = new Set(op.qualifications.map((q) => q.code));
  return courses.filter(
    (c) =>
      c.unlocked &&
      c.eligibleRoles.includes(op.roleCode) &&
      !held.has(c.grantsQualification) &&
      c.prerequisites.every((q) => held.has(q)),
  );
}

/** Operator sheet: a right-hand drawer on desktop, a full-height sheet on phones. */
export function OperatorSheet({ personnelId, onClose }: { personnelId: string | null; onClose: () => void }) {
  const t = useTranslations('personnel.sheet');
  const tc = useTranslations('common');
  const desktop = useIsDesktop();
  const open = personnelId !== null;
  if (desktop)
    return (
      <Drawer
        open={open}
        onOpenChange={(next) => !next && onClose()}
        title={t('title')}
        closeLabel={tc('close')}
        className="w-[min(460px,92vw)]"
      >
        {personnelId ? <OperatorDetail personnelId={personnelId} onClose={onClose} /> : null}
      </Drawer>
    );
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title={t('title')}
        closeLabel={tc('close')}
        className="h-[94dvh] [&>div]:px-0 [&>div]:py-0"
      >
        {personnelId ? <OperatorDetail personnelId={personnelId} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function OperatorDetail({ personnelId, onClose }: { personnelId: string; onClose: () => void }) {
  const careerId = useCareerId();
  const t = useTranslations('personnel.sheet');
  const tc = useTranslations('common');
  const tr = useTranslations('personnel.busyReason');
  const tx = useI18nText();
  const name = useCatalogName();
  const locale = useLocale();
  const { facilities } = useSnapshot();
  const detail = usePersonnelDetail(personnelId);
  const trainingFeature = useFeature('TRAINING');
  const training = useTraining().data;
  const teams = useTeams(useFeature('TEAMS').unlocked).data;
  const invalidate = useInvalidatePersonnel();
  const onError = useCommandError();
  const now = useServerNow(5000);
  const [confirmDismiss, setConfirmDismiss] = React.useState(false);
  const [destination, setDestination] = React.useState<string>();
  const [courseCode, setCourseCode] = React.useState<string>();

  const op = detail.data;
  const rest = useMutation({
    mutationFn: () => personnelApi.rest(careerId, personnelId),
    onSuccess: () => {
      track('personnel_rest_started', { personnelId });
      toast({ tone: 'success', title: t('restStarted') });
      void invalidate();
    },
    onError: (e) => onError(e),
  });
  const transfer = useMutation({
    mutationFn: (facilityId: string) => personnelApi.transfer(careerId, personnelId, facilityId),
    onSuccess: () => {
      track('personnel_transferred', { personnelId });
      toast({ tone: 'success', title: t('transferStarted') });
      setDestination(undefined);
      void invalidate();
    },
    onError: (e) => onError(e),
  });
  const dismiss = useMutation({
    mutationFn: () => personnelApi.dismiss(careerId, personnelId),
    onSuccess: () => {
      track('personnel_dismissed', { personnelId });
      toast({ tone: 'info', title: t('dismissed') });
      void invalidate();
      onClose();
    },
    onError: (e) => onError(e),
  });
  const enroll = useMutation({
    mutationFn: (course: Course) =>
      personnelApi.enroll(careerId, { courseCode: course.code, personnelIds: [personnelId] }),
    onSuccess: (_r, course) => {
      track('training_enrolled', { courseCode: course.code, count: 1 });
      toast({ tone: 'success', title: t('enrolled') });
      setCourseCode(undefined);
      void invalidate();
    },
    onError: (e, course) => onError(e, course.cost),
  });

  /** History params carry catalog CODES (`course`, `severity`): their names come from the catalog bundle. */
  const localise = (text: I18nText): I18nText => {
    const { course, severity } = text.params ?? {};
    if (typeof course !== 'string' && typeof severity !== 'string') return text;
    return {
      key: text.key,
      params: {
        ...text.params,
        ...(typeof course === 'string' ? { course: name('course', course) } : {}),
        ...(typeof severity === 'string' ? { severity: name('injurySeverity', severity) } : {}),
      },
    };
  };

  if (!op)
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );

  const facility = facilities.find((f) => f.id === op.facilityId);
  const team = teams?.find((x) => x.id === op.teamId);
  const enrollment = training?.enrollments.find((e) => e.personnelId === op.id && e.status === 'IN_PROGRESS');
  const speedupTarget =
    op.busyReason && op.busyReason in SPEEDUP_TARGET
      ? SPEEDUP_TARGET[op.busyReason as keyof typeof SPEEDUP_TARGET]
      : null;
  const speedupId = op.busyReason === 'TRAINING' ? enrollment?.id : op.id;
  const idle = isIdle(op);
  const destinations = facilities.filter(
    (f) =>
      f.id !== op.facilityId &&
      f.status === 'OPERATIONAL' &&
      (f.family === op.family || f.family === 'SHARED'),
  );
  const courses = eligibleCourses(op, training?.courses ?? []);
  const selectedCourse = courses.find((c) => c.code === courseCode);
  const canRest = idle && fatigueAt(op.fatigue, now) >= MIN_FATIGUE_TO_REST;

  return (
    <div className="flex flex-col gap-5 p-4" data-testid="operator-sheet">
      <header className="flex items-center gap-3">
        <FamilyBadge family={op.family} size={40} title={name('family', op.family)} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display truncate text-lg font-bold" title={`${op.firstName} ${op.lastName}`}>
            {op.firstName} {op.lastName}
          </h2>
          <p className="text-muted truncate text-sm" title={name('role', op.roleCode)}>
            {name('role', op.roleCode)}
          </p>
        </div>
        <PersonnelStatusChip status={op.status} />
      </header>

      {op.busyReason ? (
        <div
          className="border-border bg-surface-2 flex flex-wrap items-center gap-2 rounded-md border p-3"
          data-testid="operator-busy"
        >
          <Hourglass className="text-muted size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 text-sm">{tr(op.busyReason)}</span>
          {op.busyUntil ? (
            <Countdown to={op.busyUntil} doneLabel={tc('arriving')} className="text-sm font-semibold" />
          ) : null}
          {speedupTarget && speedupId ? (
            <SpeedupButton
              target={speedupTarget}
              targetId={speedupId}
              endsAt={op.busyUntil}
              size="sm"
              onDone={() => void invalidate()}
            />
          ) : null}
        </div>
      ) : null}

      {op.injury ? (
        <div
          className="border-danger/40 bg-danger/10 flex items-start gap-2 rounded-md border p-3"
          data-testid="injury-card"
        >
          <HeartPulse className="text-danger mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">
              {t('injury', { severity: name('injurySeverity', op.injury.severity) })}
            </p>
            <p className="text-muted">
              {t('injuryRecovery')}{' '}
              <Countdown to={op.injury.recoversAt} doneLabel={tc('arriving')} className="font-semibold" />
            </p>
          </div>
        </div>
      ) : null}

      <section>
        <SectionTitle>{t('fatigue')}</SectionTitle>
        <FatigueGauge fatigue={op.fatigue} />
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Stat label={t('facility')} value={facility?.name ?? '—'} />
        <Stat label={t('team')} value={team?.name ?? t('noTeam')} />
        <Stat label={t('competence')} value={`${op.competence}/100`} />
        <Stat label={t('missions')} value={op.missions} />
        <Stat
          label={t('costPerPeriod')}
          value={<CreditAmount value={op.costPerPeriod} label={tc('credits')} />}
        />
        <Stat label={t('hiredAt')} value={formatDateTime(op.hiredAt, locale)} />
      </section>

      <section>
        <SectionTitle>{t('qualifications')}</SectionTitle>
        {op.qualifications.length === 0 ? (
          <p className="text-muted text-sm">{t('noQualifications')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {op.qualifications.map((q) => (
              <li key={q.code} className="flex items-center justify-between gap-2 text-sm">
                <Badge tone="info">{name('qualification', q.code)}</Badge>
                <span className="text-subtle text-xs">
                  {t('obtained', { date: formatDateTime(q.obtainedAt, locale) })}
                  {q.expiresAt ? ` · ${t('expires', { date: formatDateTime(q.expiresAt, locale) })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle className="mb-0">{t('actions')}</SectionTitle>
        <Button
          variant="secondary"
          onClick={() => rest.mutate()}
          loading={rest.isPending}
          disabled={!canRest}
          data-testid="action-rest"
        >
          <BedDouble className="size-4" aria-hidden />
          {t('rest')}
        </Button>

        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Select
              label={t('course')}
              placeholder={
                trainingFeature.unlocked
                  ? courses.length
                    ? t('coursePlaceholder')
                    : t('noCourses')
                  : tc('requiresLevel', { level: trainingFeature.requiredLevel ?? 2 })
              }
              value={courseCode}
              onValueChange={setCourseCode}
              options={courses.map((c) => ({
                value: c.code,
                label: `${tx(c.name)} · ${formatAmount(c.cost, locale)}`,
              }))}
              className="min-w-0 flex-1"
            />
            <Button
              variant="secondary"
              disabled={!idle || !selectedCourse}
              loading={enroll.isPending}
              onClick={() => selectedCourse && enroll.mutate(selectedCourse)}
              data-testid="action-enroll"
            >
              <GraduationCap className="size-4" aria-hidden />
              {t('enroll')}
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Select
            label={t('destination')}
            placeholder={destinations.length ? t('destinationPlaceholder') : t('noDestination')}
            value={destination}
            onValueChange={setDestination}
            options={destinations.map((f) => ({
              value: f.id,
              label: `${f.name} · ${t('beds', { count: freeBeds(f) })}`,
              disabled: freeBeds(f) === 0,
            }))}
            className="min-w-0 flex-1"
          />
          <Button
            variant="secondary"
            disabled={!idle || !destination}
            loading={transfer.isPending}
            onClick={() => destination && transfer.mutate(destination)}
            data-testid="action-transfer"
          >
            <ArrowLeftRight className="size-4" aria-hidden />
            {t('transfer')}
          </Button>
        </div>

        {confirmDismiss ? (
          <div
            role="alertdialog"
            aria-label={t('dismissConfirmTitle')}
            className="border-danger/40 bg-danger/10 flex flex-col gap-2 rounded-md border p-3"
          >
            <p className="text-sm font-semibold">{t('dismissConfirmTitle')}</p>
            <p className="text-muted text-sm">{t('dismissConfirmBody', { name: op.firstName })}</p>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setConfirmDismiss(false)}>
                {tc('cancel')}
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                loading={dismiss.isPending}
                onClick={() => dismiss.mutate()}
                data-testid="confirm-dismiss"
              >
                {t('dismissConfirm')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="danger"
            onClick={() => setConfirmDismiss(true)}
            disabled={['ON_MISSION', 'TRAINING', 'TRANSFERRING'].includes(op.status)}
            data-testid="action-dismiss"
          >
            <UserMinus className="size-4" aria-hidden />
            {t('dismiss')}
          </Button>
        )}
      </section>

      <section>
        <SectionTitle>{t('history')}</SectionTitle>
        <Timeline
          label={t('history')}
          items={op.history.map((h, i) => ({
            id: `${h.at}-${i}`,
            time: formatDateTime(h.at, locale),
            title: tx(localise(h.text)),
            tone: h.kind === 'INJURED' ? 'danger' : h.kind.endsWith('DONE') ? 'success' : 'neutral',
          }))}
        />
      </section>
    </div>
  );
}
