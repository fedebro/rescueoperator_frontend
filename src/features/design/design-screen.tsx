'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Bell, Inbox, Plus, Search } from 'lucide-react';
import type { ServiceFamily } from '@/contracts';
import { toast } from '@/stores/toast';
import { FamilyBadge, GameIcon, TopdownGlyph, VEHICLE_CLASSES } from '@/design/icons';
import { iconGallery } from '@/design/icons/gallery';
import { Logo } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { BottomSheet, type SheetSnap } from '@/components/ui/bottom-sheet';
import { Button, IconButton } from '@/components/ui/button';
import { CapabilityBar } from '@/components/ui/capability-bar';
import { Countdown, Eta } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { Field, Input } from '@/components/ui/input';
import { Card, EmptyState, ProgressBar, Skeleton } from '@/components/ui/misc';
import { OtpInput } from '@/components/ui/otp-input';
import { Select } from '@/components/ui/select';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { STATUS_VISUALS, StatusChip } from '@/components/ui/status-chip';
import { Checkbox, Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Timeline } from '@/components/ui/timeline';
import { Tooltip } from '@/components/ui/tooltip';

const FAMILIES: ServiceFamily[] = ['FIRE', 'EMS', 'POLICE', 'WILDFIRE', 'ALPINE', 'UNG'];
const TOKENS = [
  'bg',
  'surface-1',
  'surface-2',
  'surface-3',
  'surface-4',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'text-subtle',
  'brand',
  'silver',
  'skyline',
  'focus',
  'success',
  'warning',
  'danger',
  'info',
  'credits',
  'xp',
];
interface Row {
  id: string;
  callSign: string;
  status: string;
  eta: number;
}
const ROWS: Row[] = Array.from({ length: 2000 }, (_, i) => ({
  id: `r${i}`,
  callSign: `APS ${i + 1}`,
  status: Object.keys(STATUS_VISUALS)[9 + (i % 6)]!,
  eta: (i * 37) % 900,
}));

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-3" data-testid={`design-${id}`}>
      <h2 id={`${id}-h`} className="font-display border-border border-b pb-2 text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

const ICON_GALLERY = iconGallery();

/** Living style guide: every design-system component, token and icon on one page. */
export function DesignScreen() {
  const t = useTranslations('design');
  const tc = useTranslations('common');
  const [otp, setOtp] = React.useState('12');
  const [select, setSelect] = React.useState<string | undefined>('b');
  const [drawer, setDrawer] = React.useState(false);
  const [sheet, setSheet] = React.useState<SheetSnap | null>(null);
  const [inFive] = React.useState(() => new Date(Date.now() + 5 * 60_000).toISOString());
  const columns: Column<Row>[] = [
    {
      id: 'callSign',
      header: t('table.callSign'),
      cell: (r) => <span className="font-semibold">{r.callSign}</span>,
      sortValue: (r) => r.callSign,
    },
    {
      id: 'status',
      header: t('table.status'),
      width: '180px',
      cell: (r) => <StatusChip status={r.status} label={r.status} />,
    },
    {
      id: 'eta',
      header: tc('eta'),
      width: '100px',
      align: 'right',
      cell: (r) => r.eta,
      sortValue: (r) => r.eta,
    },
  ];
  const legend = {
    onScene: t('cap.onScene'),
    enRoute: t('cap.enRoute'),
    planned: t('cap.planned'),
    required: t('cap.required'),
  };
  return (
    <main className="h-dvh-safe scroll-y bg-bg">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-8">
        <header className="flex flex-col gap-3">
          <Logo variant="horizontal" className="w-60" />
          <h1 className="font-display text-3xl font-extrabold">{t('title')}</h1>
          <p className="text-muted max-w-2xl">{t('intro')}</p>
        </header>

        <Section id="brand" title={t('sections.brand')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="grid place-items-center">
              <Logo variant="stacked" className="w-44" />
            </Card>
            <Card className="grid place-items-center">
              <Logo variant="icon" className="w-24" />
            </Card>
            <Card className="grid place-items-center">
              <Logo variant="mono" className="w-48" />
            </Card>
          </div>
        </Section>

        <Section id="tokens" title={t('sections.tokens')}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {TOKENS.map((n) => (
              <li
                key={n}
                className="border-border bg-surface-1 flex items-center gap-2 rounded-md border p-2"
              >
                <span
                  className="border-border-strong size-8 shrink-0 rounded-sm border"
                  style={{ background: `var(--rc-${n})` }}
                />
                <code className="text-muted truncate text-[11px]">--rc-{n}</code>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            {FAMILIES.map((f) => (
              <span
                key={f}
                className="border-border bg-surface-1 flex items-center gap-2 rounded-md border py-1 pr-3 pl-1 text-xs font-semibold"
              >
                <FamilyBadge family={f} />
                {f}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 10 }, (_, i) => (
              <SeverityBadge key={i} severity={i + 1} label={t('severity')} escalating={i === 7} />
            ))}
          </div>
        </Section>

        <Section id="typography" title={t('sections.typography')}>
          <p className="font-display text-3xl font-extrabold">Exo 2 — {t('typo.display')}</p>
          <p className="text-base">Inter — {t('typo.body')}</p>
          <p className="tabular text-xl">JetBrains Mono — 04:37 · 1.250 · APS-12 · inc_01J8Z</p>
        </Section>

        <Section id="buttons" title={t('sections.buttons')}>
          <div className="flex flex-wrap items-center gap-2">
            <Button>{t('btn.primary')}</Button>
            <Button variant="secondary">{t('btn.secondary')}</Button>
            <Button variant="outline">{t('btn.outline')}</Button>
            <Button variant="ghost">{t('btn.ghost')}</Button>
            <Button variant="danger">{t('btn.danger')}</Button>
            <Button variant="link">{t('btn.link')}</Button>
            <Button loading>{t('btn.loading')}</Button>
            <Button disabled>{t('btn.disabled')}</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">SM</Button>
            <Button size="md">MD</Button>
            <Button size="lg">LG</Button>
            <IconButton label={t('btn.add')}>
              <Plus className="size-5" aria-hidden />
            </IconButton>
            <IconButton label={t('btn.notifications')} variant="secondary">
              <Bell className="size-5" aria-hidden />
            </IconButton>
            <Tooltip content={t('tooltip')}>
              <Button variant="outline">{t('btn.hover')}</Button>
            </Tooltip>
          </div>
        </Section>

        <Section id="forms" title={t('sections.forms')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('form.label')} htmlFor="d-in" hint={t('form.hint')}>
              <Input id="d-in" placeholder={t('form.placeholder')} leading={<Search className="size-4" />} />
            </Field>
            <Field label={t('form.label')} htmlFor="d-err" error={t('form.error')}>
              <Input id="d-err" invalid defaultValue="???" />
            </Field>
            <Field label="Select" htmlFor="d-sel">
              <Select
                id="d-sel"
                label="Select"
                value={select}
                onValueChange={setSelect}
                options={[
                  { value: 'a', label: 'Alpha' },
                  { value: 'b', label: 'Bravo' },
                  { value: 'c', label: 'Charlie', disabled: true },
                ]}
              />
            </Field>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox defaultChecked />
                {t('form.checkbox')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch defaultChecked />
                {t('form.switch')}
              </label>
            </div>
          </div>
          <OtpInput label="OTP" value={otp} onChange={setOtp} />
        </Section>

        <Section id="status" title={t('sections.status')}>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(STATUS_VISUALS).map((s) => (
              <StatusChip key={s} status={s} label={s} />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['neutral', 'brand', 'success', 'warning', 'danger', 'info', 'credits', 'xp'] as const).map(
              (tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ),
            )}
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <CreditAmount value="12500" label={tc('credits')} size="lg" />
            <CreditAmount value="240" sign label={tc('credits')} />
            <CreditAmount value="-900" sign label={tc('credits')} />
            <Countdown to={inFive} />
            <Eta arriveAt={inFive} label={tc('eta')} doneLabel={tc('arriving')} />
          </div>
        </Section>

        <Section id="capability" title={t('sections.capability')}>
          <Card className="flex max-w-md flex-col gap-3">
            <CapabilityBar
              label={t('cap.a')}
              icon={<GameIcon name="cap_fire_suppression" size={16} />}
              required={90}
              onScene={75}
              enRoute={35}
              level="REQUIRED"
              levelLabel={t('cap.required')}
              legend={legend}
            />
            <CapabilityBar
              label={t('cap.b')}
              icon={<GameIcon name="cap_water_supply" size={16} />}
              required={50}
              onScene={0}
              enRoute={45}
              planned={40}
              level="REQUIRED"
              levelLabel={t('cap.required')}
              legend={legend}
            />
            <CapabilityBar
              label={t('cap.c')}
              icon={<GameIcon name="cap_height_access" size={16} />}
              required={60}
              onScene={100}
              enRoute={0}
              level="RECOMMENDED"
              levelLabel={t('cap.recommended')}
              legend={legend}
            />
          </Card>
          <ProgressBar value={0.62} label="62%" showValue className="max-w-md" />
          <ProgressBar value={0.3} label="30%" tone="xp" className="max-w-md" />
        </Section>

        <Section id="overlays" title={t('sections.overlays')}>
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Dialog</Button>
              </DialogTrigger>
              <DialogContent
                title={t('dialog.title')}
                description={t('dialog.body')}
                closeLabel={tc('close')}
              >
                <DialogFooter>
                  <Button>{tc('confirm')}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="secondary" onClick={() => setDrawer(true)}>
              Drawer
            </Button>
            <Button variant="secondary" onClick={() => setSheet('half')}>
              BottomSheet
            </Button>
            {(['info', 'success', 'warning', 'danger'] as const).map((tone) => (
              <Button
                key={tone}
                variant="outline"
                onClick={() => toast({ tone, title: t('toast.title'), description: t('toast.body') })}
              >
                Toast · {tone}
              </Button>
            ))}
          </div>
          <Drawer open={drawer} onOpenChange={setDrawer} title="Drawer" closeLabel={tc('close')}>
            <p className="text-muted p-4 text-sm">{t('dialog.body')}</p>
          </Drawer>
          {sheet ? (
            <BottomSheet
              snap={sheet}
              onSnapChange={setSheet}
              handleLabel={t('sheet')}
              header={
                <div className="flex items-center justify-between px-4 pb-2">
                  <p className="font-semibold">BottomSheet · {sheet}</p>
                  <Button size="sm" variant="ghost" onClick={() => setSheet(null)}>
                    {tc('close')}
                  </Button>
                </div>
              }
            >
              <p className="text-muted p-4 text-sm">{t('sheetBody')}</p>
            </BottomSheet>
          ) : null}
        </Section>

        <Section id="data" title={t('sections.data')}>
          <Tabs defaultValue="dense">
            <TabsList>
              <TabsTrigger value="dense">{t('table.dense')}</TabsTrigger>
              <TabsTrigger value="compact">{t('table.compact')}</TabsTrigger>
            </TabsList>
            <TabsContent value="dense" className="pt-3">
              <DataTable
                caption={t('table.dense')}
                columns={columns}
                rows={ROWS}
                rowKey={(r) => r.id}
                maxHeight={260}
              />
            </TabsContent>
            <TabsContent value="compact" className="pt-3">
              <DataTable
                caption={t('table.compact')}
                density="compact"
                columns={columns}
                rows={ROWS.slice(0, 40)}
                rowKey={(r) => r.id}
                maxHeight={260}
              />
            </TabsContent>
          </Tabs>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <Timeline
                label="Timeline"
                items={[
                  { id: '1', time: '14:02', title: t('timeline.a'), tone: 'danger' },
                  { id: '2', time: '14:03', title: t('timeline.b'), tone: 'warning' },
                  { id: '3', time: '14:07', title: t('timeline.c'), tone: 'info' },
                  { id: '4', time: '14:12', title: t('timeline.d'), tone: 'success' },
                ]}
              />
            </Card>
            <Card className="flex flex-col gap-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-16" />
              <EmptyState
                icon={<Inbox className="size-5" />}
                title={t('empty.title')}
                description={t('empty.body')}
                className="py-4"
              />
            </Card>
          </div>
        </Section>

        <Section id="icons" title={t('sections.icons')}>
          {ICON_GALLERY.map((group) => (
            <section key={group.id} aria-labelledby={`icons-${group.id}`} className="flex flex-col gap-2">
              {/* Group headings are code identifiers (catalog key patterns), not translated copy. */}
              <h3 id={`icons-${group.id}`} className="text-muted flex items-baseline gap-2 text-sm">
                <code className="text-text font-semibold">{group.id}</code>
                <span className="text-subtle tabular-nums">{group.entries.length}</span>
              </h3>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    data-icon={entry.name}
                    className="border-border bg-surface-1 flex min-w-0 flex-col items-center gap-1.5 rounded-md border p-2"
                    title={`${entry.id} → ${entry.name}`}
                  >
                    <span className="flex items-center gap-2">
                      <GameIcon name={entry.name} size={28} />
                      {/* 20px = the size used in dense tables: every glyph must still read here. */}
                      <GameIcon name={entry.name} size={20} className="text-muted" />
                      {entry.topdown ? (
                        <TopdownGlyph
                          vehicleClass={entry.topdown.vehicleClass}
                          family={entry.topdown.family}
                          size={28}
                        />
                      ) : null}
                    </span>
                    <code className="text-subtle w-full text-center text-[10px] leading-tight break-words">
                      {entry.id}
                    </code>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <h3 className="text-muted text-sm">
            <code className="text-text font-semibold">topdown</code>{' '}
            <span className="text-subtle tabular-nums">{VEHICLE_CLASSES.length}</span>
          </h3>
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-9">
            {VEHICLE_CLASSES.map((c, i) => (
              <li
                key={c}
                className="border-border flex flex-col items-center gap-1 rounded-md border bg-[#111C2E] p-2"
                title={c}
              >
                <TopdownGlyph vehicleClass={c} family={FAMILIES[i % 5]!} size={40} />
                <code className="text-subtle text-[9px]">{c}</code>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}
