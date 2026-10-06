'use client';
import * as React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  ALLIANCE_DESCRIPTION_MAX,
  ALLIANCE_NAME_MAX,
  ALLIANCE_TAG_MAX,
  type AllianceConfigDto,
  type AllianceJoinPolicy,
  type AllianceLogEntryDto,
  type MyAllianceDto,
  type SupportedLocale,
  type UpdateAllianceSettingsBody,
} from '@/contracts';
import { allianceApi } from '@/lib/api/alliance';
import { qk } from '@/lib/api/query-keys';
import { LOCALES, LOCALE_NAMES } from '@/i18n/config';
import { formatDateTime } from '@/lib/format';
import { useCareerId } from '@/features/game/hooks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TimeAgo } from '@/components/ui/time-ago';
import { EmblemPicker } from './emblem';
import { validateFound } from './found-form';
import { useAllianceMutation } from './hooks';

/** Which fields changed, as the PATCH body (nothing unchanged is sent: the name/tag cooldown only counts real changes). */
export function settingsDiff(alliance: MyAllianceDto, v: SettingsValues): UpdateAllianceSettingsBody {
  const body: UpdateAllianceSettingsBody = {};
  if (v.name.trim() !== alliance.name) body.name = v.name.trim();
  if (v.tag.trim().toUpperCase() !== alliance.tag) body.tag = v.tag.trim().toUpperCase();
  if (JSON.stringify(v.emblem) !== JSON.stringify(alliance.emblem)) body.emblem = v.emblem;
  if (v.description.trim() !== alliance.description) body.description = v.description.trim();
  if (v.language !== alliance.language) body.language = v.language;
  if (v.joinPolicy !== alliance.joinPolicy) body.joinPolicy = v.joinPolicy;
  if (v.minLevel !== alliance.minLevel) body.minLevel = v.minLevel;
  if (v.membersCanInvite !== alliance.settings.membersCanInvite) body.membersCanInvite = v.membersCanInvite;
  if (v.notesByHighRolesOnly !== alliance.settings.notesByHighRolesOnly)
    body.notesByHighRolesOnly = v.notesByHighRolesOnly;
  return body;
}

interface SettingsValues {
  name: string;
  tag: string;
  emblem: MyAllianceDto['emblem'];
  description: string;
  language: SupportedLocale;
  joinPolicy: AllianceJoinPolicy;
  minLevel: number | null;
  membersCanInvite: boolean;
  notesByHighRolesOnly: boolean;
}

/** Impostazioni dell'alleanza (coordinator): identity, emblem, access, invite and board rules, disband (study 02 §3). */
export function AllianceSettingsSheet({
  alliance,
  config,
  open,
  onOpenChange,
}: {
  alliance: MyAllianceDto;
  config: AllianceConfigDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('alliance.settings');
  const tf = useTranslations('alliance.found');
  const tp = useTranslations('alliance.policy');
  const tc = useTranslations('common');
  const [values, setValues] = React.useState<SettingsValues>(() => fromAlliance(alliance));
  const [touched, setTouched] = React.useState(false);
  const [confirmDisband, setConfirmDisband] = React.useState(false);
  // The form starts from the current alliance every time: the sheet is mounted only while open (see alliance-screen).
  const errors = validateFound({ ...values });
  const diff = settingsDiff(alliance, values);
  const dirty = Object.keys(diff).length > 0;
  const set = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const save = useAllianceMutation(
    (careerId, body: UpdateAllianceSettingsBody) => allianceApi.updateSettings(careerId, body),
    {
      successToast: t('saved'),
      applyHome: (data, home) => ({ ...home, alliance: data }),
      onSuccess: () => onOpenChange(false),
    },
  );
  const disband = useAllianceMutation((careerId) => allianceApi.disband(careerId), {
    successToast: (a) => (a.status === 'DISBANDED' ? t('disbanded') : t('disbandScheduled')),
    onSuccess: () => {
      setConfirmDisband(false);
      onOpenChange(false);
    },
  });
  const cancelDisband = useAllianceMutation((careerId) => allianceApi.cancelDisband(careerId), {
    successToast: t('disbandCancelled'),
    applyHome: (data, home) => ({ ...home, alliance: data }),
  });
  const error = (field: 'name' | 'tag' | 'description') =>
    touched && errors[field] ? tf(`error.${field}.${errors[field]}`) : null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length > 0 || !dirty) return;
    save.mutate(diff);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('title')}
        closeLabel={tc('close')}
        aria-describedby={undefined}
        className="md:w-[min(760px,92vw)]"
      >
        <form
          onSubmit={submit}
          className="scroll-y flex min-h-0 flex-col gap-4 px-4 pb-2"
          noValidate
          data-testid="alliance-settings"
        >
          <div>
            <SectionTitle level={3}>{t('identity')}</SectionTitle>
            <p className="text-subtle mb-2 text-xs">
              {t('nameCooldown', { days: config.nameChangeCooldownDays })}
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <Field label={tf('name')} htmlFor="settings-name" error={error('name')}>
                <Input
                  id="settings-name"
                  value={values.name}
                  maxLength={ALLIANCE_NAME_MAX}
                  onChange={(e) => set('name', e.target.value)}
                  invalid={!!error('name')}
                  data-testid="settings-name"
                />
              </Field>
              <Field label={tf('tag')} htmlFor="settings-tag" error={error('tag')}>
                <Input
                  id="settings-tag"
                  value={values.tag}
                  maxLength={ALLIANCE_TAG_MAX}
                  onChange={(e) =>
                    set(
                      'tag',
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, '')
                        .slice(0, ALLIANCE_TAG_MAX),
                    )
                  }
                  invalid={!!error('tag')}
                  className="tabular uppercase"
                />
              </Field>
            </div>
            <Field
              label={tf('description')}
              htmlFor="settings-description"
              error={error('description')}
              className="mt-3"
            >
              <Textarea
                id="settings-description"
                value={values.description}
                maxLength={ALLIANCE_DESCRIPTION_MAX}
                counter
                rows={3}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
          </div>
          <div>
            <SectionTitle level={3}>{tf('emblem')}</SectionTitle>
            <EmblemPicker
              value={values.emblem}
              onChange={(emblem) => set('emblem', emblem)}
              options={config.emblem}
              level={alliance.progress.level}
            />
          </div>
          <div>
            <SectionTitle level={3}>{t('access')}</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={tf('language')} htmlFor="settings-language">
                <Select
                  id="settings-language"
                  label={tf('language')}
                  value={values.language}
                  onValueChange={(v) => set('language', v as SupportedLocale)}
                  options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
                />
              </Field>
              <Field
                label={tf('policy')}
                htmlFor="settings-policy"
                hint={tf(`policyHint.${values.joinPolicy}`)}
              >
                <Select
                  id="settings-policy"
                  label={tf('policy')}
                  value={values.joinPolicy}
                  onValueChange={(v) => set('joinPolicy', v as AllianceJoinPolicy)}
                  options={(['OPEN', 'REQUEST', 'INVITE'] as const).map((p) => ({ value: p, label: tp(p) }))}
                />
              </Field>
              <Field label={tf('minLevel')} htmlFor="settings-min-level">
                <Select
                  id="settings-min-level"
                  label={tf('minLevel')}
                  value={values.minLevel === null ? 'none' : String(values.minLevel)}
                  onValueChange={(v) => set('minLevel', v === 'none' ? null : Number(v))}
                  options={[
                    { value: 'none', label: tf('minLevelNone') },
                    ...[3, 5, 8, 10, 15, 20].map((l) => ({
                      value: String(l),
                      label: tf('minLevelValue', { level: l }),
                    })),
                  ]}
                />
              </Field>
            </div>
            <div className="divide-border mt-2 divide-y">
              <label className="flex items-center justify-between gap-4 py-3 text-sm">
                <span>
                  <span className="font-semibold">{t('membersCanInvite')}</span>
                  <span className="text-muted block text-xs">{t('membersCanInviteHint')}</span>
                </span>
                <Switch
                  checked={values.membersCanInvite}
                  onCheckedChange={(v) => set('membersCanInvite', v)}
                  aria-label={t('membersCanInvite')}
                  data-testid="settings-members-invite"
                />
              </label>
              <label className="flex items-center justify-between gap-4 py-3 text-sm">
                <span>
                  <span className="font-semibold">{t('notesHighRolesOnly')}</span>
                  <span className="text-muted block text-xs">{t('notesHighRolesOnlyHint')}</span>
                </span>
                <Switch
                  checked={values.notesByHighRolesOnly}
                  onCheckedChange={(v) => set('notesByHighRolesOnly', v)}
                  aria-label={t('notesHighRolesOnly')}
                />
              </label>
            </div>
          </div>
          <div className="border-danger/40 bg-danger/5 rounded-md border p-3">
            <SectionTitle level={3}>{t('danger')}</SectionTitle>
            {alliance.disbandAt ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {t('disbandRunning')} <TimeAgo at={alliance.disbandAt} />
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => cancelDisband.mutate(undefined)}
                  loading={cancelDisband.isPending}
                  data-testid="settings-cancel-disband"
                >
                  {t('cancelDisband')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted text-xs">
                  {t('disbandBody', { hours: config.disbandNoticeHours })}
                </span>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmDisband(true)}
                  data-testid="settings-disband"
                >
                  {t('disband')}
                </Button>
              </div>
            )}
          </div>
          <DialogFooter className="px-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={!dirty} loading={save.isPending} data-testid="settings-save">
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <Dialog open={confirmDisband} onOpenChange={setConfirmDisband}>
        <DialogContent
          title={t('confirmDisband', { name: alliance.name })}
          description={t('confirmDisbandBody', { hours: config.disbandNoticeHours })}
          closeLabel={tc('close')}
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDisband(false)}>
              {tc('cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => disband.mutate(undefined)}
              loading={disband.isPending}
              data-testid="confirm-disband"
            >
              {t('disband')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

const fromAlliance = (a: MyAllianceDto): SettingsValues => ({
  name: a.name,
  tag: a.tag,
  emblem: a.emblem,
  description: a.description,
  language: a.language,
  joinPolicy: a.joinPolicy,
  minLevel: a.minLevel,
  membersCanInvite: a.settings.membersCanInvite,
  notesByHighRolesOnly: a.settings.notesByHighRolesOnly,
});

/** Registro dell'alleanza (study 02 §3): every action of a high role, of the system and of the administration. */
export function AllianceLogDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('alliance.log');
  const tc = useTranslations('common');
  const locale = useLocale();
  const careerId = useCareerId();
  const log = useInfiniteQuery({
    queryKey: qk.allianceLog(careerId),
    queryFn: ({ pageParam }) => allianceApi.log(careerId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
    enabled: open,
    staleTime: 10_000,
  });
  const rows: AllianceLogEntryDto[] = log.data?.pages.flatMap((p) => p.data) ?? [];
  const detail = (e: AllianceLogEntryDto): string => {
    const parts: string[] = [];
    if (typeof e.details.role === 'string') parts.push(t(`detailRole.${e.details.role}` as never));
    if (typeof e.details.duration === 'string')
      parts.push(t(`detailDuration.${e.details.duration}` as never));
    if (typeof e.details.field === 'string') parts.push(t('detailField', { field: String(e.details.field) }));
    return parts.join(' · ');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('title')} closeLabel={tc('close')} aria-describedby={undefined}>
        <div className="scroll-y min-h-0 px-4 pb-4" data-testid="alliance-log">
          {log.isPending ? (
            <Skeleton className="h-32" />
          ) : rows.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ol className="divide-border divide-y text-sm">
              {rows.map((e) => (
                <li key={e.id} className="py-2" data-testid="log-entry" data-action={e.action}>
                  <p>
                    <span className="font-semibold">
                      {e.byAdmin ? t('byAdmin') : (e.actor?.directorName ?? t('system'))}
                    </span>{' '}
                    {t(`action.${e.action}`, { target: e.target?.directorName ?? '' })}
                    {detail(e) ? <span className="text-muted"> · {detail(e)}</span> : null}
                  </p>
                  <p className="text-subtle text-xs" title={formatDateTime(e.at, locale)}>
                    <TimeAgo at={e.at} />
                  </p>
                </li>
              ))}
            </ol>
          )}
          {log.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void log.fetchNextPage()}
              loading={log.isFetchingNextPage}
            >
              {t('more')}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LogEntryText({ entry }: { entry: AllianceLogEntryDto }) {
  const t = useTranslations('alliance.log');
  return <>{t(`action.${entry.action}`, { target: entry.target?.directorName ?? '' })}</>;
}
