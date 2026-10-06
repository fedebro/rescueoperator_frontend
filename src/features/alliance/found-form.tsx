'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ALLIANCE_DESCRIPTION_MAX,
  ALLIANCE_NAME_MAX,
  ALLIANCE_NAME_MIN,
  ALLIANCE_TAG_MAX,
  ALLIANCE_TAG_MIN,
  AllianceTag,
  type AllianceConfigDto,
  type AllianceEmblemDto,
  type AllianceJoinPolicy,
  type FoundAllianceBody,
  type SupportedLocale,
} from '@/contracts';
import { LOCALES, LOCALE_NAMES } from '@/i18n/config';
import { formatAmount } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Card, SectionTitle } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CreditAmount } from '@/components/ui/credit-amount';
import { DEFAULT_EMBLEM, EmblemPicker } from './emblem';

export interface FoundFormValues {
  name: string;
  tag: string;
  emblem: AllianceEmblemDto;
  description: string;
  language: SupportedLocale;
  joinPolicy: AllianceJoinPolicy;
  minLevel: number | null;
}

/** Pure validation of the founding form (the server re-checks everything, the text filter included). */
export function validateFound(
  v: FoundFormValues,
): Partial<Record<'name' | 'tag' | 'description', 'short' | 'long' | 'format'>> {
  const errors: Partial<Record<'name' | 'tag' | 'description', 'short' | 'long' | 'format'>> = {};
  const name = v.name.trim();
  if (name.length < ALLIANCE_NAME_MIN) errors.name = 'short';
  else if (name.length > ALLIANCE_NAME_MAX) errors.name = 'long';
  if (!AllianceTag.safeParse(v.tag).success)
    errors.tag =
      v.tag.trim().length < ALLIANCE_TAG_MIN
        ? 'short'
        : v.tag.trim().length > ALLIANCE_TAG_MAX
          ? 'long'
          : 'format';
  if (v.description.length > ALLIANCE_DESCRIPTION_MAX) errors.description = 'long';
  return errors;
}

export const toFoundBody = (v: FoundFormValues): FoundAllianceBody => ({
  name: v.name.trim(),
  tag: v.tag.trim().toUpperCase(),
  emblem: v.emblem,
  description: v.description.trim(),
  language: v.language,
  joinPolicy: v.joinPolicy,
  minLevel: v.minLevel,
});

/**
 * "Fonda un'alleanza" (study 09 §2.1): name, tag, guided emblem, language, access policy, minimum level — with the cost
 * and the level requirement in plain sight. Every number comes from `AllianceConfigDto`.
 */
export function FoundForm({
  config,
  level,
  credits,
  onSubmit,
  pending,
}: {
  config: AllianceConfigDto;
  level: number;
  credits: string;
  onSubmit: (body: FoundAllianceBody) => void;
  pending?: boolean;
}) {
  const t = useTranslations('alliance.found');
  const tp = useTranslations('alliance.policy');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [values, setValues] = React.useState<FoundFormValues>({
    name: '',
    tag: '',
    emblem: DEFAULT_EMBLEM,
    description: '',
    language: (LOCALES as readonly string[]).includes(locale) ? (locale as SupportedLocale) : 'it',
    joinPolicy: 'OPEN',
    minLevel: null,
  });
  const [touched, setTouched] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const errors = validateFound(values);
  const valid = Object.keys(errors).length === 0;
  const cost = BigInt(config.foundCost);
  const canAfford = BigInt(credits) >= cost;
  const levelOk = level >= config.foundLevel;
  const set = <K extends keyof FoundFormValues>(key: K, value: FoundFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const error = (field: 'name' | 'tag' | 'description') =>
    touched && errors[field] ? t(`error.${field}.${errors[field]}`) : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || !levelOk || !canAfford) return;
    setConfirm(true);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="found-form" noValidate>
      <Card className="flex flex-col gap-4">
        <SectionTitle>{t('identity')}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field
            label={t('name')}
            htmlFor="found-name"
            hint={t('nameHint', { min: ALLIANCE_NAME_MIN, max: ALLIANCE_NAME_MAX })}
            error={error('name')}
          >
            <Input
              id="found-name"
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={ALLIANCE_NAME_MAX}
              invalid={!!error('name')}
              autoComplete="off"
              data-testid="found-name"
            />
          </Field>
          <Field
            label={t('tag')}
            htmlFor="found-tag"
            hint={t('tagHint', { min: ALLIANCE_TAG_MIN, max: ALLIANCE_TAG_MAX })}
            error={error('tag')}
          >
            <Input
              id="found-tag"
              value={values.tag}
              onChange={(e) =>
                set(
                  'tag',
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, ALLIANCE_TAG_MAX),
                )
              }
              maxLength={ALLIANCE_TAG_MAX}
              invalid={!!error('tag')}
              autoComplete="off"
              className="tabular uppercase"
              data-testid="found-tag"
            />
          </Field>
        </div>
        <Field
          label={t('description')}
          htmlFor="found-description"
          hint={t('descriptionHint')}
          error={error('description')}
        >
          <Textarea
            id="found-description"
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            maxLength={ALLIANCE_DESCRIPTION_MAX}
            counter
            rows={3}
            data-testid="found-description"
          />
        </Field>
      </Card>
      <Card className="flex flex-col gap-3">
        <SectionTitle>{t('emblem')}</SectionTitle>
        <EmblemPicker
          value={values.emblem}
          onChange={(emblem) => set('emblem', emblem)}
          options={config.emblem}
          level={1}
        />
      </Card>
      <Card className="flex flex-col gap-4">
        <SectionTitle>{t('access')}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('language')} htmlFor="found-language" hint={t('languageHint')}>
            <Select
              id="found-language"
              label={t('language')}
              value={values.language}
              onValueChange={(v) => set('language', v as SupportedLocale)}
              options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
            />
          </Field>
          <Field label={t('policy')} htmlFor="found-policy" hint={t(`policyHint.${values.joinPolicy}`)}>
            <Select
              id="found-policy"
              label={t('policy')}
              value={values.joinPolicy}
              onValueChange={(v) => set('joinPolicy', v as AllianceJoinPolicy)}
              options={(['OPEN', 'REQUEST', 'INVITE'] as const).map((p) => ({ value: p, label: tp(p) }))}
            />
          </Field>
          <Field label={t('minLevel')} htmlFor="found-min-level" hint={t('minLevelHint')}>
            <Select
              id="found-min-level"
              label={t('minLevel')}
              value={values.minLevel === null ? 'none' : String(values.minLevel)}
              onValueChange={(v) => set('minLevel', v === 'none' ? null : Number(v))}
              options={[
                { value: 'none', label: t('minLevelNone') },
                ...[3, 5, 8, 10, 15, 20].map((l) => ({
                  value: String(l),
                  label: t('minLevelValue', { level: l }),
                })),
              ]}
            />
          </Field>
        </div>
      </Card>
      <div
        className="border-border bg-surface-2 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
        data-testid="found-summary"
      >
        <div className="text-sm">
          <p className="font-semibold">
            {cost === 0n ? (
              t('free')
            ) : (
              <>
                {t('costLabel')} <CreditAmount value={config.foundCost} label={t('costLabel')} />
              </>
            )}
          </p>
          <p
            className={levelOk ? 'text-muted text-xs' : 'text-warning text-xs font-semibold'}
            data-testid="found-requirement"
          >
            {levelOk
              ? t('requirement', { level: config.foundLevel })
              : t('requirementMissing', { level: config.foundLevel, current: level })}
          </p>
          {levelOk && !canAfford ? (
            <p className="text-warning text-xs font-semibold">
              {t('cannotAfford', { credits: formatAmount(credits, locale) })}
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={!levelOk || !canAfford || pending}
          loading={pending}
          data-testid="found-submit"
        >
          {t('cta')}
        </Button>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          title={t('confirm', { name: values.name.trim() })}
          description={
            cost === 0n
              ? t('confirmBodyFree')
              : t('confirmBody', { cost: formatAmount(config.foundCost, locale) })
          }
          closeLabel={tc('close')}
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={() => {
                setConfirm(false);
                onSubmit(toFoundBody(values));
              }}
              loading={pending}
              data-testid="found-confirm"
            >
              {t('cta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
