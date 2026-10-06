'use client';
import * as React from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Crosshair,
  Hourglass,
  Medal,
  Radio,
  ShieldPlus,
  Siren,
  Timer,
  TrendingUp,
  Truck,
  X,
} from 'lucide-react';
import type { IncidentDto, MajorGroupDto, MajorIncidentDto, MajorSectorDto, VehicleDto } from '@/contracts';
import { formatAmount, formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';
import { useServerNow } from '@/hooks/use-server-now';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { FamilyBadge, GameIcon, capabilityIconName } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CapabilityBar } from '@/components/ui/capability-bar';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { EmptyState, ProgressBar, SectionTitle, Skeleton } from '@/components/ui/misc';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { StatusChip } from '@/components/ui/status-chip';
import { useFamilyLabel } from '@/features/facilities/site-details';
import { incidentScene } from '@/features/water/water';
import { useSnapshot } from '@/features/game/hooks';
import { InspectorHeaderButton, SHEET_HEADER } from '@/features/game/inspector-parts';
import { useMajor, useRequestReinforcements } from './hooks';
import { AidMajorSection } from '@/features/alliance/aid-incident';
import { OperationStrip } from '@/features/alliance/operation-strip';
import {
  OPERATIONAL_PHASES,
  assignedVehicles,
  columnEtaSeconds,
  groupNeeds,
  groupShares,
  liveGroups,
  liveProgress,
  percent,
  phaseIndex,
  rewardLine,
  vehiclesByFamily,
} from './major';

/** The major's alarm glyph: a siren in the major colour, breathing while the event runs. */
export function MajorGlyph({ active, size = 40 }: { active: boolean; size?: number }) {
  return (
    <span
      className={cn(
        'bg-major/15 text-major border-major/60 relative grid shrink-0 place-items-center rounded-md border',
        active && 'animate-major-flash',
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Siren style={{ width: size * 0.55, height: size * 0.55 }} />
    </span>
  );
}

/** ALARM → CONTAINMENT → RESCUE → SECURING: numbered steps, the current one highlighted (never colour alone). */
function PhaseStepper({ major }: { major: MajorIncidentDto }) {
  const t = useTranslations('maxi.view');
  const tx = useI18nText();
  const current = phaseIndex(major.phase);
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label={t('phase')} data-testid="major-phases">
      {OPERATIONAL_PHASES.map((phase, index) => {
        const done = index < current;
        const now = index === current;
        const name = tx({ key: `major.phase.${phase}.name` });
        return (
          <li
            key={phase}
            aria-current={now ? 'step' : undefined}
            data-phase={phase}
            data-state={done ? 'done' : now ? 'current' : 'next'}
            className="flex min-w-0 flex-col items-center gap-1 text-center"
          >
            <span
              className={cn(
                'grid size-7 place-items-center rounded-full border-2 text-xs font-bold',
                now
                  ? 'border-major bg-major text-inverse'
                  : done
                    ? 'border-major/60 text-major'
                    : 'border-border-strong text-subtle',
              )}
            >
              {index + 1}
            </span>
            <span
              className={cn(
                'line-clamp-2 text-xs leading-tight',
                now ? 'text-fg font-bold' : done ? 'text-muted' : 'text-subtle',
              )}
            >
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Where the event stands: phase text, the main scene's progress, the clock that matters now, growth. */
function PhaseSection({ major, main }: { major: MajorIncidentDto; main: IncidentDto | undefined }) {
  const t = useTranslations('maxi.view');
  const tx = useI18nText();
  const now = useServerNow(1000, major.status === 'ACTIVE');
  const progress = liveProgress(main, major.progress, now);
  const pending = main?.status === 'PENDING_RESPONSE';
  const uncovered = !!main && (main.status !== 'ON_SCENE' || main.coverageRatio < 0.6);
  // The next growth check only matters while the main scene is left uncovered and the event can still grow.
  const nextGrowthAt = uncovered && major.growth.level < major.growth.max ? major.growth.nextCheckAt : null;
  return (
    <section className="flex flex-col gap-3" aria-label={t('phase')}>
      <PhaseStepper major={major} />
      <p className="text-muted text-sm" data-testid="major-phase-description">
        {tx({ key: `major.phase.${major.phase}.description` })}
      </p>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
          <span className="text-muted font-semibold">{t('mainProgress')}</span>
          {pending && main?.expiresAt ? (
            <span
              className="text-warning inline-flex items-center gap-1 font-semibold"
              data-testid="major-expires"
            >
              <Timer className="size-3.5 shrink-0" aria-hidden />
              <span>{t('expiresIn')}</span>
              <Countdown to={main.expiresAt} urgentBelowSeconds={120} />
            </span>
          ) : main?.work.estimatedEndAt ? (
            <span className="text-info inline-flex items-center gap-1">
              <Hourglass className="size-3.5 shrink-0" aria-hidden />
              <span>{t('endsIn')}</span>
              <Countdown to={main.work.estimatedEndAt} doneLabel="…" />
            </span>
          ) : null}
        </div>
        <ProgressBar
          value={progress}
          label={t('mainProgress')}
          tone={progress >= 0.75 ? 'success' : 'info'}
          showValue
        />
      </div>
      {major.growth.level > 0 || (nextGrowthAt && major.status === 'ACTIVE') ? (
        <div
          className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
          data-testid="major-growth"
          data-level={major.growth.level}
        >
          <TrendingUp className="text-warning mt-px size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 leading-relaxed">
            {major.growth.level > 0 ? (
              <span className="text-warning font-semibold">
                {t('growth', { level: major.growth.level, max: major.growth.max })}
              </span>
            ) : null}
            {major.growth.level > 0 && nextGrowthAt ? ' · ' : null}
            {nextGrowthAt ? (
              <span className="text-muted">
                {t('growthNext')}{' '}
                <Countdown to={nextGrowthAt} doneLabel="…" className="text-fg font-semibold" />
              </span>
            ) : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * One service: a stacked bar (on scene · on the way) over what the fleet has to bring, how many of its needs are covered,
 * and whether a column helps; tap for the single needs.
 */
function GroupRow({ group }: { group: MajorGroupDto }) {
  const t = useTranslations('maxi.view');
  const tr = useTranslations('game.requirements');
  const tx = useI18nText();
  const familyLabel = useFamilyLabel();
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const shares = groupShares(group);
  const external = group.capabilities.every((c) => c.external);
  const needs = groupNeeds(group);
  const label = group.family ? familyLabel(group.family) : t('otherNeeds');
  const legend = {
    onScene: tr('onScene'),
    enRoute: tr('enRoute'),
    planned: tr('planned'),
    required: tr('required'),
  };
  return (
    <li
      className="border-border bg-surface-2 rounded-md border"
      data-testid="major-group"
      data-family={group.family ?? ''}
      data-coverage={group.coverage}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-11 w-full flex-col gap-1.5 px-3 py-2 text-left"
      >
        <span className="flex w-full items-center gap-2 text-sm">
          {group.family ? <FamilyBadge family={group.family} size={22} /> : null}
          <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
          {external ? (
            <Badge tone="info">{t('external')}</Badge>
          ) : !needs.measured ? (
            // Nothing indispensable in this service: its coverage (1 by definition) would read "100 %" over an empty bar.
            <span className="text-muted shrink-0 text-xs font-semibold" data-testid="major-group-level">
              {tr(`level.${needs.topLevel}`)}
            </span>
          ) : (
            <span
              className={cn(
                'shrink-0 text-xs font-bold tabular-nums',
                group.coverage >= 1 ? 'text-success' : group.coverage >= 0.6 ? 'text-warning' : 'text-danger',
              )}
            >
              {t('coverage', { percent: percent(group.coverage) })}
            </span>
          )}
          <ChevronDown
            className={cn('text-muted size-4 shrink-0 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </span>
        {external ? null : (
          <span
            role="img"
            aria-label={t('groupAria', {
              family: label,
              onScene: percent(shares.onScene),
              enRoute: percent(shares.enRoute),
            })}
            className="bg-surface-3 relative block h-2.5 w-full overflow-hidden rounded-full"
          >
            <span
              className="bg-success absolute inset-y-0 left-0"
              style={{ width: `${shares.onScene * 100}%` }}
            />
            <span
              className="absolute inset-y-0"
              style={{
                left: `${shares.onScene * 100}%`,
                width: `${shares.enRoute * 100}%`,
                backgroundImage:
                  'repeating-linear-gradient(135deg, var(--rc-warning) 0 3px, transparent 3px 5px)',
              }}
            />
          </span>
        )}
        <span className="text-subtle flex flex-wrap gap-x-3 text-xs tabular-nums">
          {external || needs.total === 0 ? null : (
            <span>{t('needsCovered', { covered: needs.covered, total: needs.total })}</span>
          )}
          {shares.enRoute > 0 ? (
            <span className="text-warning">{t('enRouteShare', { percent: percent(shares.enRoute) })}</span>
          ) : null}
          {group.reinforced > 0 ? <span className="text-info">{t('withReinforcements')}</span> : null}
        </span>
      </button>
      {open ? (
        <div id={id} className="border-border flex flex-col gap-2.5 border-t px-3 py-2.5">
          {group.capabilities.map((c) =>
            c.external ? (
              <div
                key={c.capability}
                className="flex items-center gap-2 text-xs"
                data-testid="major-capability-external"
              >
                <GameIcon name={capabilityIconName(c.capability)} size={16} className="text-muted" />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {tx({ key: `catalog.capability.${c.capability}` })}
                </span>
                <Badge tone="info">{c.reinforced > 0 ? t('byReinforcements') : t('external')}</Badge>
              </div>
            ) : (
              <CapabilityBar
                key={c.capability}
                label={tx({ key: `catalog.capability.${c.capability}` })}
                icon={<GameIcon name={capabilityIconName(c.capability)} size={16} />}
                required={c.required}
                onScene={c.onScene}
                enRoute={c.enRoute}
                level={c.level}
                levelLabel={tr(`level.${c.level}`)}
                legend={legend}
              />
            ),
          )}
        </div>
      ) : null}
    </li>
  );
}

/** "Mezzi assegnati per settore": each member incident with its status, coverage and the vehicles on it, by service. */
function SectorCard({
  sector,
  incident,
  vehicles,
}: {
  sector: MajorSectorDto;
  incident: IncidentDto | undefined;
  vehicles: VehicleDto[];
}) {
  const t = useTranslations('maxi.view');
  const ts = useTranslations('status.incident');
  const tsv = useTranslations('status.vehicle');
  const tx = useI18nText();
  const select = useUiStore((s) => s.select);
  const familyLabel = useFamilyLabel();
  const [open, setOpen] = React.useState(false);
  const status = incident?.status ?? sector.status;
  const closed = ['RESOLVED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(status);
  const coverage = incident?.coverageRatio ?? sector.coverageRatio;
  const title = tx(incident?.title ?? sector.title);
  const label =
    sector.role === 'MAIN'
      ? tx({ key: 'major.sector.main' })
      : tx({ key: 'major.sector.sub', params: { count: sector.sector } });
  const byFamily = vehiclesByFamily(vehicles);
  return (
    <li
      className={cn(
        'border-border bg-surface-2 rounded-md border',
        sector.role === 'MAIN' && 'border-major/50',
        closed && 'opacity-70',
      )}
      data-testid="major-sector"
      data-incident-id={sector.incidentId}
      data-role={sector.role}
      data-status={status}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          disabled={!incident || closed}
          onClick={() =>
            incident && select({ kind: 'incident', id: incident.id }, { focus: incidentScene(incident) })
          }
          className="flex min-h-14 min-w-0 flex-1 flex-col gap-1 px-3 py-2 text-left disabled:cursor-default"
          aria-label={incident && !closed ? t('sectorOpen', { title }) : undefined}
        >
          <span className="flex w-full items-center gap-2">
            <span
              className={cn(
                'shrink-0 text-xs font-bold tracking-wide uppercase',
                sector.role === 'MAIN' ? 'text-major' : 'text-subtle',
              )}
            >
              {label}
            </span>
            <StatusChip status={status} label={ts(status)} />
            {incident && !closed ? (
              <ChevronRight className="text-muted ml-auto size-4 shrink-0" aria-hidden />
            ) : null}
          </span>
          <span className="text-fg line-clamp-2 text-sm leading-snug font-semibold">{title}</span>
          <span className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <SeverityBadge severity={incident?.severity ?? sector.severity} label={t('severity')} size="sm" />
            {!closed ? (
              <span className="tabular-nums">{t('coverage', { percent: percent(coverage) })}</span>
            ) : null}
            {sector.role === 'SUB' ? <span>{tx({ key: `major.cause.${sector.cause}` })}</span> : null}
          </span>
        </button>
      </div>
      {!closed ? (
        <div className="border-border border-t px-3 py-1.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            disabled={vehicles.length === 0}
            className="flex min-h-11 w-full items-center gap-2 text-left text-xs disabled:cursor-default"
            data-testid="major-sector-vehicles"
            data-count={vehicles.length}
          >
            <Truck className="text-muted size-4 shrink-0" aria-hidden />
            <span className="text-muted shrink-0">{t('sectorVehicles', { count: vehicles.length })}</span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {byFamily.map((g) => (
                <span key={g.family} className="inline-flex items-center gap-1" title={familyLabel(g.family)}>
                  <FamilyBadge family={g.family} size={18} />
                  <span className="tabular text-fg font-semibold">{g.vehicles.length}</span>
                </span>
              ))}
            </span>
            {vehicles.length > 0 ? (
              <ChevronDown
                className={cn('text-muted size-4 shrink-0 transition-transform', open && 'rotate-180')}
                aria-hidden
              />
            ) : null}
          </button>
          {open ? (
            <ul className="flex flex-col gap-1 pb-1.5">
              {vehicles.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => select({ kind: 'vehicle', id: v.id })}
                    className="hover:bg-surface-3 flex min-h-11 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm"
                  >
                    <FamilyBadge family={v.family} size={18} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{v.callSign}</span>
                    <StatusChip status={v.status} label={tsv(v.status)} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** "Chiedi rinforzi" (06 §2.4): what a column would cover, when it would arrive, what it costs in bonus; the columns sent. */
function ReinforcementsSection({ major }: { major: MajorIncidentDto }) {
  const t = useTranslations('maxi.view');
  const tx = useI18nText();
  const catalog = useCatalogName();
  const now = useServerNow(
    1000,
    major.reinforcements.requests.some((r) => r.status === 'EN_ROUTE'),
  );
  const request = useRequestReinforcements(major.id);
  const quote = major.reinforcements.quote;
  const ended = major.status === 'ENDED';
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="major-reinforcements"
      data-testid="major-reinforcements"
      data-available={quote.available}
      data-blocked={quote.blockedReason ?? ''}
    >
      <SectionTitle className="mb-0">
        <span id="major-reinforcements">{t('reinforcements')}</span>
      </SectionTitle>
      {!ended ? (
        <div className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3">
          <p className="text-muted text-xs leading-relaxed">
            {tx({
              key: 'major.reinforcements.explain',
              params: { percent: percent(quote.coverageShare) },
            })}
          </p>
          {quote.available ? (
            <dl className="grid grid-cols-3 gap-2 text-xs" data-testid="major-quote">
              <div className="flex min-w-0 flex-col">
                <dt className="text-subtle font-semibold">{t('quoteCover')}</dt>
                <dd className="tabular text-fg text-base font-bold">{percent(quote.coverageShare)}%</dd>
              </div>
              <div className="flex min-w-0 flex-col">
                <dt className="text-subtle font-semibold">{t('quoteCost')}</dt>
                <dd className="tabular text-warning text-base font-bold" data-testid="major-quote-cost">
                  −{percent(quote.rewardReductionShare)}%
                </dd>
              </div>
              <div className="flex min-w-0 flex-col">
                <dt className="text-subtle font-semibold">{t('quoteEta')}</dt>
                <dd className="tabular text-fg text-base font-bold">{formatClock(quote.etaSeconds)}</dd>
              </div>
            </dl>
          ) : null}
          {quote.available && quote.families.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              {quote.families.map((f) => (
                <FamilyBadge key={f} family={f} size={18} title={catalog('family', f)} />
              ))}
              {quote.priority ? (
                <Badge tone="info">
                  <ShieldPlus className="size-3" aria-hidden />
                  {t('priority')}
                </Badge>
              ) : null}
            </p>
          ) : null}
          <Button
            variant={quote.available ? 'primary' : 'secondary'}
            className="h-11 w-full"
            disabled={!quote.available}
            loading={request.isPending}
            onClick={() => request.mutate()}
            data-testid="major-request-reinforcements"
          >
            <ShieldPlus className="size-4" aria-hidden />
            {tx({ key: 'major.reinforcements.action' })}
          </Button>
          {!quote.available && quote.blockedReason ? (
            <p className="text-subtle text-xs" role="status" data-testid="major-reinforcements-blocked">
              {tx({ key: `major.reinforcements.blocked.${quote.blockedReason}` })}
            </p>
          ) : null}
        </div>
      ) : null}
      {major.reinforcements.requests.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {major.reinforcements.requests.map((r) => (
            <li
              key={r.id}
              className="border-border bg-surface-2 flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-xs"
              data-testid="major-column"
              data-status={r.status}
            >
              <ShieldPlus
                className={cn('size-4 shrink-0', r.status === 'ON_SCENE' ? 'text-success' : 'text-info')}
                aria-hidden
              />
              <span className="text-fg font-semibold">
                {tx({ key: `major.reinforcements.status.${r.status}` })}
              </span>
              <span className="text-muted tabular-nums">
                {t('columnShare', { percent: percent(r.coverageShare) })}
              </span>
              {r.status === 'EN_ROUTE' ? (
                <span className="tabular text-info ml-auto">
                  {formatClock(columnEtaSeconds(r.arriveAt, now))}
                </span>
              ) : null}
              <span className="text-subtle w-full truncate">{tx(r.source)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {major.reinforcements.reinforcedShare > 0 ? (
        <p className="text-info text-xs" data-testid="major-reinforced-share">
          {t('reinforcedTotal', { percent: percent(major.reinforcements.reinforcedShare) })}
        </p>
      ) : null}
    </section>
  );
}

/** The major's own bonus: the estimate while it runs, the real one (medal, quality, notes) once it ended. */
function RewardSection({ major }: { major: MajorIncidentDto }) {
  const t = useTranslations('maxi.view');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const locale = useLocale();
  const line = rewardLine(major);
  const ended = major.status === 'ENDED';
  return (
    <section className="flex flex-col gap-2" aria-labelledby="major-reward" data-testid="major-reward">
      <SectionTitle className="mb-0">
        <span id="major-reward">{ended ? t('summary') : t('reward')}</span>
      </SectionTitle>
      <div className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3">
        {ended ? (
          <>
            <p
              className="font-display text-base font-bold"
              data-testid="major-outcome"
              data-outcome={major.outcome}
            >
              {tx({ key: `major.outcome.${major.outcome ?? 'SUCCESS'}` })}
            </p>
            {major.reward.medal ? (
              <p className="flex items-center gap-2 text-sm font-semibold" data-testid="major-medal">
                <Medal
                  className={cn(
                    'size-5',
                    major.reward.medal === 'GOLD'
                      ? 'text-credits'
                      : major.reward.medal === 'SILVER'
                        ? 'text-silver'
                        : 'text-warning',
                  )}
                  aria-hidden
                />
                {tx({ key: `major.medal.${major.reward.medal}.title` })}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <CreditAmount value={major.reward.credits ?? '0'} sign label={tc('credits')} />
              {major.reward.xp && major.reward.xp !== '0' ? (
                <span className="text-xp font-semibold tabular-nums">
                  {t('xp', { xp: formatAmount(major.reward.xp, locale) })}
                </span>
              ) : null}
              {major.reward.quality !== null ? (
                <span className="text-muted tabular-nums">
                  {t('quality', { percent: percent(major.reward.quality) })}
                </span>
              ) : null}
            </div>
            {major.reward.notes.length > 0 ? (
              <ul className="text-muted flex flex-col gap-1 text-xs">
                {major.reward.notes.map((n, i) => (
                  <li key={`${n.key}-${i}`} className="flex gap-1.5">
                    <span aria-hidden className="bg-subtle mt-1.5 size-1 shrink-0 rounded-full" />
                    {tx(n)}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="major-reward-estimate">
              <CreditAmount value={line.min} label={tc('credits')} />
              <span className="text-subtle">–</span>
              <CreditAmount value={line.max} label={tc('credits')} />
            </p>
            <p className="text-subtle text-xs">{t('rewardHint')}</p>
          </>
        )}
        <p className="text-subtle text-xs">
          {t('fleet', { operational: major.fleet.operational, target: major.fleet.targetVehicles })}
        </p>
      </div>
    </section>
  );
}

/**
 * Coordination view of a major incident (06 §2.6): phase and progress, requirement bars GROUPED by service, the sectors
 * with the vehicles on each of them, reinforcements, the bonus. Runs in the inspector slot of every layout (desktop column,
 * tablet panel, phone bottom sheet); the member incidents open their own inspector from here.
 */
export function MajorInspector({ majorId }: { majorId: string }) {
  const t = useTranslations('maxi.view');
  const tx = useI18nText();
  const { incidents, vehicles } = useSnapshot();
  const clear = useUiStore((s) => s.clearSelection);
  const focusOn = useUiStore((s) => s.focusOn);
  const query = useMajor(majorId);
  const major = query.data;
  const members = React.useMemo(() => incidents.filter((i) => i.major?.id === majorId), [incidents, majorId]);
  const main = members.find((i) => i.major?.role === 'MAIN');
  const groups = React.useMemo(
    () => (major?.status === 'ENDED' ? [] : liveGroups(members, major?.groups)),
    [members, major],
  );
  if (!major)
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="major-inspector" data-loading>
        <header className="flex items-start gap-3 px-4 pb-3 md:pt-3" {...SHEET_HEADER}>
          <MajorGlyph active={false} />
          <div className="min-w-0 flex-1 pt-1">
            {query.isError ? (
              <p className="text-danger text-sm">{t('loadError')}</p>
            ) : (
              <Skeleton className="h-10" />
            )}
          </div>
          <InspectorHeaderButton label={t('close')} onClick={clear} className="-my-1 -mr-2">
            <X className="size-5" aria-hidden />
          </InspectorHeaderButton>
        </header>
      </div>
    );
  const active = major.status === 'ACTIVE';
  const sectors = [...major.sectors].sort((a, b) => a.sector - b.sector);
  const committed = vehicles.filter(
    (v) => v.incidentId !== null && members.some((m) => m.id === v.incidentId),
  );
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-testid="major-inspector"
      data-major-id={major.id}
      data-status={major.status}
      data-phase={major.phase}
    >
      <header className="border-border shrink-0 border-b px-4 pb-2 md:pt-3" {...SHEET_HEADER}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5">
            <MajorGlyph active={active} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-major text-xs font-bold tracking-[0.08em] uppercase">
              {tx({ key: 'major.common.title' })}
            </p>
            <h2
              className="font-display line-clamp-2 text-base leading-snug font-bold lg:text-lg lg:leading-tight"
              data-testid="major-title"
            >
              {tx(major.title)}
            </h2>
            <p className="text-muted mt-0.5 truncate text-xs" title={major.address}>
              {major.address}
            </p>
          </div>
          <InspectorHeaderButton
            label={t('centerOnMap')}
            onClick={() => focusOn(major.center, 14)}
            className="-my-1"
          >
            <Crosshair className="size-5" aria-hidden />
          </InspectorHeaderButton>
          <InspectorHeaderButton
            label={t('close')}
            onClick={clear}
            data-testid="inspector-close"
            className="-my-1 -mr-2"
          >
            <X className="size-5" aria-hidden />
          </InspectorHeaderButton>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={active ? 'danger' : 'neutral'} data-testid="major-phase-chip">
            <Radio className="size-3" aria-hidden />
            {tx({ key: `major.phase.${major.phase}.name` })}
          </Badge>
          <SeverityBadge severity={major.severity} label={t('severity')} />
          {major.severityBoosted ? <Badge tone="warning">{t('boosted')}</Badge> : null}
          {major.trigger.weather ? (
            <Badge tone="info">{tx({ key: `game.world.weather.${major.trigger.weather}` })}</Badge>
          ) : null}
          {active ? (
            <Countdown
              to={major.startedAt}
              elapsed
              className="text-subtle ml-auto shrink-0 text-xs"
              prefix={
                <>
                  <Clock className="size-3.5" aria-hidden />
                  <span className="sr-only">{t('elapsed')}</span>
                </>
              }
            />
          ) : (
            <Badge
              tone={major.outcome === 'SUCCESS' ? 'success' : 'warning'}
              data-testid="major-outcome-chip"
            >
              {tx({ key: `major.outcome.${major.outcome ?? 'SUCCESS'}` })}
            </Badge>
          )}
        </div>
      </header>
      <div
        className="scroll-y flex min-h-0 flex-1 flex-col gap-5 p-4"
        data-sheet-scroll
        data-testid="major-body"
      >
        {/* Alliances (D-106, 09 §5): this major is my front of an alliance operation. */}
        <OperationStrip major={major} />
        {!active ? <RewardSection major={major} /> : null}
        {active ? <PhaseSection major={major} main={main} /> : null}
        {active ? (
          <section className="flex flex-col gap-2" aria-labelledby="major-needs">
            <SectionTitle
              className="mb-0"
              action={<span className="text-subtle text-xs">{t('needsHint')}</span>}
            >
              <span id="major-needs">{t('needs')}</span>
            </SectionTitle>
            {groups.length === 0 ? (
              <EmptyState title={t('needsNone')} className="py-4" />
            ) : (
              <ul className="flex flex-col gap-1.5" data-testid="major-groups">
                {groups.map((g) => (
                  <GroupRow key={g.family ?? '-'} group={g} />
                ))}
              </ul>
            )}
          </section>
        ) : null}
        <section className="flex flex-col gap-2" aria-labelledby="major-sectors">
          <SectionTitle
            className="mb-0"
            action={
              active ? (
                <span className="text-muted text-xs" data-testid="major-committed">
                  {t('committed', { count: committed.length })}
                </span>
              ) : null
            }
          >
            <span id="major-sectors">{t('sectors', { count: sectors.length })}</span>
          </SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {sectors.map((sector) => {
              const incident = members.find((i) => i.id === sector.incidentId);
              return (
                <SectorCard
                  key={sector.incidentId}
                  sector={sector}
                  incident={incident}
                  vehicles={incident ? assignedVehicles(incident, vehicles) : []}
                />
              );
            })}
          </ul>
        </section>
        {active ? <ReinforcementsSection major={major} /> : null}
        {/* Alliances (D-102, 05 §7): allied columns next to the system's reinforcements. */}
        <AidMajorSection major={major} />
        {active ? <RewardSection major={major} /> : null}
      </div>
    </div>
  );
}
