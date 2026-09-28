'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Clock, GraduationCap, Lock, X } from 'lucide-react';
import type { PersonnelDto } from '@/contracts';
import { personnelApi } from '@/lib/api/depth';
import { track } from '@/lib/analytics';
import { compareAmount, formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { FamilyBadge } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { Checkbox } from '@/components/ui/switch';
import { SpeedupAllButton, SpeedupButton } from '@/features/monetization/speedup-button';
import { requestCredits } from '@/features/monetization/insufficient-credits';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { eligibleCourses } from './operator-sheet';
import { LockedFeature } from './locked-feature';
import {
  useCommandError,
  useFeature,
  useInvalidatePersonnel,
  usePersonnel,
  useTraining,
  type Course,
} from './queries';

const MAX_TRAINEES = 20;

/** Free training slots left in a facility once the trainees already picked in this dialog are counted too;
 * unbounded when the facility has no slot data yet (mirrors the server, which only rejects a facility it knows). */
export function remainingTrainingSlots(
  slot: { total: number; used: number } | undefined,
  alreadyPicked: number,
): number {
  return slot ? slot.total - slot.used - alreadyPicked : Infinity;
}

export function TrainingTab({ onSelect }: { onSelect: (id: string) => void }) {
  const careerId = useCareerId();
  const t = useTranslations('personnel.training');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const name = useCatalogName();
  const feature = useFeature('TRAINING');
  const { facilities } = useSnapshot();
  const overview = useTraining();
  const people = usePersonnel().data ?? [];
  const invalidate = useInvalidatePersonnel();
  const onError = useCommandError();
  const [enrolling, setEnrolling] = React.useState<Course | null>(null);

  const cancel = useMutation({
    mutationFn: (id: string) => personnelApi.cancelEnrollment(careerId, id),
    onSuccess: () => {
      track('training_cancelled');
      toast({ tone: 'info', title: t('cancelled') });
      void invalidate();
    },
    onError: (e) => onError(e),
  });

  if (!feature.unlocked && feature.requiredLevel !== null)
    return (
      <LockedFeature feature="TRAINING" requiredLevel={feature.requiredLevel} description={t('lockedHint')} />
    );
  if (!overview.data) return <Skeleton className="h-60" />;

  const { courses, enrollments, slots } = overview.data;
  const running = enrollments.filter((e) => e.status === 'IN_PROGRESS');
  const person = (id: string) => people.find((p) => p.id === id);
  const sorted = [...courses].sort(
    (a, b) => Number(b.unlocked) - Number(a.unlocked) || a.requiredLevel - b.requiredLevel,
  );

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle>{t('slots')}</SectionTitle>
        <ul className="flex flex-wrap gap-2">
          {slots.map((s) => (
            <li key={s.facilityId}>
              <Badge tone={s.used >= s.total ? 'warning' : 'neutral'} className="h-7 px-2.5 text-xs">
                <GraduationCap className="size-3.5" aria-hidden />
                {facilities.find((f) => f.id === s.facilityId)?.name ?? '—'} ·{' '}
                {t('slotsUsed', { used: s.used, total: s.total })}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="enrollments">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>{t('running')}</SectionTitle>
          <SpeedupAllButton
            items={running.map((e) => ({ target: 'TRAINING' as const, targetId: e.id, endsAt: e.endsAt }))}
            onDone={() => void invalidate()}
          />
        </div>
        {running.length === 0 ? (
          <p className="text-muted text-sm">{t('noneRunning')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {running.map((e) => {
              const p = person(e.personnelId);
              return (
                <li
                  key={e.id}
                  className="bg-surface-2 border-border flex flex-wrap items-center gap-2 rounded-md border p-2.5"
                  data-testid="enrollment-row"
                >
                  {p ? <FamilyBadge family={p.family} size={24} /> : null}
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                    onClick={() => onSelect(e.personnelId)}
                  >
                    <span className="font-semibold">{p ? `${p.firstName} ${p.lastName}` : '—'}</span>
                    <span className="text-muted"> · {name('course', e.courseCode)}</span>
                  </button>
                  <Countdown
                    to={e.endsAt}
                    doneLabel={tc('arriving')}
                    prefix={<Clock className="size-3.5" aria-hidden />}
                    className="text-sm"
                  />
                  <SpeedupButton
                    target="TRAINING"
                    targetId={e.id}
                    endsAt={e.endsAt}
                    size="sm"
                    onDone={() => void invalidate()}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => cancel.mutate(e.id)}
                    loading={cancel.isPending && cancel.variables === e.id}
                    aria-label={t('cancelFor', { name: p ? `${p.firstName} ${p.lastName}` : '' })}
                  >
                    <X className="size-4" aria-hidden />
                    {t('cancel')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {enrollments.some((e) => e.status === 'COMPLETED') ? (
          <p className="text-subtle mt-2 text-xs" data-testid="completed-count">
            {t('completed', { count: enrollments.filter((e) => e.status === 'COMPLETED').length })}
          </p>
        ) : null}
      </section>

      <section>
        <SectionTitle>{t('catalogue')}</SectionTitle>
        <ul className="grid gap-3 md:grid-cols-2">
          {sorted.map((c) => {
            const eligible = people.filter(
              (p) =>
                (p.status === 'AVAILABLE' || p.status === 'ASSIGNED') && eligibleCourses(p, [c]).length > 0,
            ).length;
            return (
              <li key={c.code}>
                <Card
                  className={`flex h-full flex-col gap-2.5 ${c.unlocked ? '' : 'opacity-70'}`}
                  data-testid="course-card"
                  data-course={c.code}
                  data-unlocked={c.unlocked}
                >
                  <div className="flex items-start gap-2">
                    {c.family ? <FamilyBadge family={c.family} size={28} /> : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{tx(c.name)}</p>
                      <p className="text-muted text-xs">{tx(c.description)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="success">
                      {t('grants', { qualification: name('qualification', c.grantsQualification) })}
                    </Badge>
                    {c.prerequisites.map((q) => (
                      <Badge key={q} tone="warning">
                        {t('requires', { qualification: name('qualification', q) })}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-subtle text-xs">
                    {t('roles')}: {c.eligibleRoles.map((r) => name('role', r)).join(', ')}
                  </p>
                  <div className="mt-auto flex items-center gap-3 pt-1">
                    <CreditAmount value={c.cost} label={tc('credits')} />
                    <span className="text-muted tabular flex items-center gap-1 text-xs">
                      <Clock className="size-3.5" aria-hidden />
                      {formatClock(c.durationSeconds)}
                    </span>
                    <span className="flex-1" />
                    {c.unlocked ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEnrolling(c)}
                        disabled={eligible === 0}
                        aria-label={t('enrollIn', { course: tx(c.name) })}
                      >
                        <GraduationCap className="size-4" aria-hidden />
                        {eligible === 0 ? t('noEligible') : t('enroll')}
                      </Button>
                    ) : (
                      <Badge tone="neutral">
                        <Lock className="size-3" aria-label={tc('locked')} />
                        {tc('requiresLevel', { level: c.requiredLevel })}
                      </Badge>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
        {courses.length === 0 ? (
          <EmptyState icon={<GraduationCap className="size-5" />} title={t('noCourses')} />
        ) : null}
      </section>

      <EnrollDialog course={enrolling} people={people} slots={slots} onClose={() => setEnrolling(null)} />
    </div>
  );
}

type TrainingSlot = { facilityId: string; total: number; used: number };

function EnrollDialog({
  course,
  people,
  slots,
  onClose,
}: {
  course: Course | null;
  people: PersonnelDto[];
  slots: TrainingSlot[];
  onClose: () => void;
}) {
  return (
    <Dialog open={course !== null} onOpenChange={(open) => !open && onClose()}>
      {/* keyed by course: the selection starts empty every time the dialog opens for another course */}
      {course ? (
        <EnrollForm key={course.code} course={course} people={people} slots={slots} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function EnrollForm({
  course,
  people,
  slots,
  onClose,
}: {
  course: Course;
  people: PersonnelDto[];
  slots: TrainingSlot[];
  onClose: () => void;
}) {
  const careerId = useCareerId();
  const t = useTranslations('personnel.training');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const name = useCatalogName();
  const { career, facilities } = useSnapshot();
  const invalidate = useInvalidatePersonnel();
  const onError = useCommandError();
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

  const candidates = people.filter(
    (p) => (p.status === 'AVAILABLE' || p.status === 'ASSIGNED') && eligibleCourses(p, [course]).length > 0,
  );
  const pickedByFacility = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const pid of picked) {
      const p = people.find((x) => x.id === pid);
      if (p) map.set(p.facilityId, (map.get(p.facilityId) ?? 0) + 1);
    }
    return map;
  }, [picked, people]);
  const slotFor = (facilityId: string) => slots.find((s) => s.facilityId === facilityId);
  const remainingSlots = (facilityId: string) =>
    remainingTrainingSlots(slotFor(facilityId), pickedByFacility.get(facilityId) ?? 0);
  const involvedFacilities = [...new Set(candidates.map((p) => p.facilityId))];
  const total = BigInt(course.cost) * BigInt(picked.size);
  const enroll = useMutation({
    mutationFn: (v: { courseCode: string; personnelIds: string[] }) => personnelApi.enroll(careerId, v),
    onSuccess: (created, v) => {
      track('training_enrolled', { courseCode: v.courseCode, count: created.length });
      toast({ tone: 'success', title: t('enrolled', { count: created.length }) });
      void invalidate();
      onClose();
    },
    onError: (e) => onError(e, total),
  });
  const submit = () => {
    if (picked.size === 0) return;
    if (compareAmount(career.credits, total) < 0) requestCredits(total);
    else enroll.mutate({ courseCode: course.code, personnelIds: [...picked] });
  };
  const toggle = (p: PersonnelDto) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else if (next.size < MAX_TRAINEES && remainingSlots(p.facilityId) > 0) next.add(p.id);
      return next;
    });

  return (
    <DialogContent
      title={t('enrollIn', { course: tx(course.name) })}
      description={t('enrollHint', { max: MAX_TRAINEES })}
      closeLabel={tc('close')}
    >
      {involvedFacilities.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" data-testid="enroll-slots">
          {involvedFacilities.flatMap((facilityId) => {
            const s = slotFor(facilityId);
            if (!s) return [];
            const used = s.used + (pickedByFacility.get(facilityId) ?? 0);
            return (
              <li key={facilityId}>
                <Badge tone={used >= s.total ? 'warning' : 'neutral'} className="text-xs">
                  <GraduationCap className="size-3" aria-hidden />
                  {facilities.find((f) => f.id === facilityId)?.name ?? '—'} ·{' '}
                  {t('slotsUsed', { used, total: s.total })}
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : null}
      <ul className="flex flex-col gap-1.5" data-testid="enroll-list">
        {candidates.map((p) => {
          const id = `trainee-${p.id}`;
          const full =
            !picked.has(p.id) && (picked.size >= MAX_TRAINEES || remainingSlots(p.facilityId) <= 0);
          return (
            <li
              key={p.id}
              className={cn(
                'bg-surface-2 border-border flex items-center gap-2.5 rounded-md border p-2.5',
                full && 'opacity-60',
              )}
              data-full={full}
            >
              <Checkbox
                id={id}
                checked={picked.has(p.id)}
                disabled={full}
                onCheckedChange={() => toggle(p)}
                aria-label={`${p.firstName} ${p.lastName}`}
              />
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm">
                <span className="block truncate font-semibold">
                  {p.firstName} {p.lastName}
                </span>
                <span className="text-muted block truncate text-xs">
                  {name('role', p.roleCode)} · {facilities.find((f) => f.id === p.facilityId)?.name ?? '—'}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <DialogFooter className="items-center">
        <span className="flex-1 text-sm">
          {t('total')}: <CreditAmount value={total.toString()} label={tc('credits')} />
        </span>
        <Button variant="ghost" onClick={onClose}>
          {tc('cancel')}
        </Button>
        <Button
          onClick={submit}
          disabled={picked.size === 0}
          loading={enroll.isPending}
          data-testid="enroll-submit"
        >
          <GraduationCap className="size-4" aria-hidden />
          {t('enrollCount', { count: picked.size })}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
