'use client';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { AdminCreditAdjustmentBody } from '@/contracts';
import { adminApi } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { formatAmount, parseAmount } from '@/lib/format';
import { toast } from '@/stores/toast';
import { Button } from '@/components/ui/button';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from './shared';

const REASON_CODES = AdminCreditAdjustmentBody.shape.reasonCode.options;
/** Same fields as the contract body; the amount is a signed non-zero integer string. */
const FormSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^-?[1-9]\d{0,14}$/, 'amountInvalid'),
  reasonCode: AdminCreditAdjustmentBody.shape.reasonCode,
  note: z.string().trim().min(5, 'noteInvalid').max(500, 'noteInvalid'),
});
type FormValues = z.infer<typeof FormSchema>;

export type AdjustmentPreview =
  { ok: true; next: bigint } | { ok: false; reason: 'INVALID' | 'NEGATIVE_BALANCE' | 'OVER_LIMIT' };
/** What the ledger would show after the entry. `limit`: null = unlimited (SUPER_ADMIN). All BigInt, never Number. */
export function previewAdjustment(balance: string, amount: string, limit: string | null): AdjustmentPreview {
  if (!/^-?[1-9]\d{0,14}$/.test(amount.trim())) return { ok: false, reason: 'INVALID' };
  const delta = BigInt(amount.trim());
  const magnitude = delta < 0n ? -delta : delta;
  if (limit !== null && magnitude > parseAmount(limit)) return { ok: false, reason: 'OVER_LIMIT' };
  const next = parseAmount(balance) + delta;
  return next < 0n ? { ok: false, reason: 'NEGATIVE_BALANCE' } : { ok: true, next };
}

/**
 * Credits change ONLY through a new ledger entry with a reason (append-only ledger): this form never edits a balance.
 * Two steps on purpose: fill + preview, then an explicit confirmation that repeats the target and the effect.
 */
export function CreditAdjustmentDialog({
  careerId,
  directorName,
  balance,
  limit,
  open,
  onOpenChange,
}: {
  careerId: string;
  directorName: string;
  balance: string;
  limit: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('admin.credit');
  const tc = useTranslations('common');
  const locale = useLocale();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [confirming, setConfirming] = React.useState<FormValues | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { amount: '', reasonCode: 'COMPENSATION', note: '' },
    mode: 'onTouched',
  });
  const amount = useWatch({ control: form.control, name: 'amount' });
  const reasonCode = useWatch({ control: form.control, name: 'reasonCode' });
  const preview = previewAdjustment(balance, amount ?? '', limit);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => adminApi.adjustCredits(careerId, values),
    onSuccess: (result) => {
      toast({ tone: 'success', title: t('done', { balance: formatAmount(result.credits, locale) }) });
      for (const key of ['career', 'careerLedger', 'careers', 'audit'])
        void qc.invalidateQueries({ queryKey: qk.admin(key) });
      onOpenChange(false);
    },
    onError: (e) => {
      setConfirming(null);
      toast({ tone: 'danger', title: errorMessage(e) });
    },
  });
  const fieldError = (name: keyof FormValues) => {
    const message = form.formState.errors[name]?.message;
    return message === 'amountInvalid' || message === 'noteInvalid' ? t(message) : null;
  };
  const blocked = !preview.ok && preview.reason !== 'INVALID' ? t(`blocked.${preview.reason}`) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}>
      <DialogContent
        title={confirming ? t('confirmTitle') : t('title')}
        description={confirming ? t('confirmBody') : t('subtitle')}
        closeLabel={tc('close')}
      >
        <p className="mb-4 text-sm">
          <span className="font-semibold">{directorName}</span>{' '}
          <code className="tabular text-muted text-xs break-all select-all">{careerId}</code>
        </p>
        {confirming ? (
          <div className="flex flex-col gap-3">
            <dl className="bg-surface-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md p-3 text-sm">
              <dt className="text-subtle">{t('amount')}</dt>
              <dd>
                <CreditAmount value={confirming.amount} sign label={t('amount')} />
              </dd>
              <dt className="text-subtle">{t('reasonCode')}</dt>
              <dd>{t(`codes.${confirming.reasonCode}`)}</dd>
              <dt className="text-subtle">{t('note')}</dt>
              <dd className="break-words">{confirming.note}</dd>
              <dt className="text-subtle">{t('resulting')}</dt>
              <dd>{preview.ok ? <CreditAmount value={preview.next} label={t('resulting')} /> : '—'}</dd>
            </dl>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirming(null)} disabled={mutation.isPending}>
                {tc('back')}
              </Button>
              <Button
                variant="danger"
                loading={mutation.isPending}
                onClick={() => mutation.mutate(confirming)}
              >
                {t('confirm')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit((values) => {
              if (previewAdjustment(balance, values.amount, limit).ok) setConfirming(values);
            })}
          >
            <Field
              label={t('amount')}
              htmlFor="admin-credit-amount"
              hint={t('amountHint')}
              error={fieldError('amount') ?? blocked}
            >
              <Input
                id="admin-credit-amount"
                inputMode="numeric"
                autoComplete="off"
                className="text-base lg:text-sm"
                invalid={!!fieldError('amount') || !!blocked}
                {...form.register('amount')}
              />
            </Field>
            <Field label={t('reasonCode')} htmlFor="admin-credit-code">
              <Select
                id="admin-credit-code"
                label={t('reasonCode')}
                value={reasonCode}
                onValueChange={(v) => form.setValue('reasonCode', v as FormValues['reasonCode'])}
                options={REASON_CODES.map((code) => ({ value: code, label: t(`codes.${code}`) }))}
              />
            </Field>
            <Field
              label={t('note')}
              htmlFor="admin-credit-note"
              hint={t('noteHint')}
              error={fieldError('note')}
            >
              <Textarea
                id="admin-credit-note"
                rows={3}
                maxLength={500}
                invalid={!!fieldError('note')}
                {...form.register('note')}
              />
            </Field>
            <dl
              className="bg-surface-2 grid grid-cols-2 gap-3 rounded-md p-3 text-sm"
              data-testid="credit-preview"
              aria-live="polite"
            >
              <div>
                <dt className="text-subtle text-xs">{t('current')}</dt>
                <dd>
                  <CreditAmount value={balance} label={t('current')} />
                </dd>
              </div>
              <div>
                <dt className="text-subtle text-xs">{t('resulting')}</dt>
                <dd>
                  {preview.ok ? (
                    <CreditAmount value={preview.next} label={t('resulting')} />
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </dd>
              </div>
            </dl>
            <DialogFooter className="mt-0">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit">{t('review')}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
