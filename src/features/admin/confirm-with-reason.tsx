'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useErrorMessage } from '@/lib/api/error-message';
import { toast } from '@/stores/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Textarea } from './shared';

export const MIN_REASON_LENGTH = 5;

export interface ConfirmWithReasonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Identifier of what is about to change — always shown so the operator can double-check it. */
  targetId?: string | null;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** When set, the operator must type exactly this text (e.g. the version being published). */
  typedConfirmation?: string;
  minReasonLength?: number;
  pending?: boolean;
  onConfirm: (reason: string) => void;
  /** Extra read-only context (preview of the effect). */
  children?: React.ReactNode;
}

/**
 * The single confirmation step of every mutating admin action (Spec 18 §37: description, impact, confirmation,
 * reason). The reason is mandatory and ends up in the audit log.
 * Mount it only while it is open (`{target ? <ConfirmWithReason open … /> : null}`) so every use starts empty.
 */
export function ConfirmWithReason({
  open,
  onOpenChange,
  title,
  description,
  targetId,
  confirmLabel,
  tone = 'danger',
  typedConfirmation,
  minReasonLength = MIN_REASON_LENGTH,
  pending,
  onConfirm,
  children,
}: ConfirmWithReasonProps) {
  const t = useTranslations('admin.confirm');
  const tc = useTranslations('common');
  const [reason, setReason] = React.useState('');
  const [typed, setTyped] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const id = React.useId();

  const reasonOk = reason.trim().length >= minReasonLength;
  const typedOk = !typedConfirmation || typed.trim() === typedConfirmation;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (reasonOk && typedOk && !pending) onConfirm(reason.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent title={title} description={description} closeLabel={tc('close')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {targetId ? (
            <p className="text-sm">
              <span className="text-subtle mr-2 text-[11px] font-semibold tracking-wide uppercase">
                {t('target')}
              </span>
              <code className="tabular bg-surface-2 rounded-sm px-1.5 py-0.5 text-xs break-all select-all">
                {targetId}
              </code>
            </p>
          ) : null}
          {children}
          <Field
            label={t('reasonLabel')}
            htmlFor={`${id}-reason`}
            hint={t('reasonHint', { min: minReasonLength })}
            error={touched && !reasonOk ? t('reasonTooShort', { min: minReasonLength }) : null}
          >
            <Textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              invalid={touched && !reasonOk}
              aria-describedby={touched && !reasonOk ? `${id}-reason-error` : undefined}
              // The dialog exists to collect the reason: focusing it first saves a step on every action.
              autoFocus
            />
          </Field>
          {typedConfirmation ? (
            <Field
              label={t('typedLabel', { text: typedConfirmation })}
              htmlFor={`${id}-typed`}
              error={touched && !typedOk ? t('typedMismatch') : null}
            >
              <Input
                id={`${id}-typed`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                invalid={touched && !typedOk}
                className="text-base lg:text-sm"
              />
            </Field>
          ) : null}
          <DialogFooter className="mt-1">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              {tc('cancel')}
            </Button>
            <Button type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} loading={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Prompt = Pick<
  ConfirmWithReasonProps,
  'title' | 'description' | 'targetId' | 'confirmLabel' | 'tone' | 'typedConfirmation' | 'children'
>;

/**
 * Wires a mutation to the confirmation dialog: `ask(vars, prompt)` opens it, confirming runs `run(vars, reason)`,
 * then the listed queries are refetched (no optimistic UI: the admin always sees what the server says).
 */
export function useReasonedAction<TVars, TResult = unknown>(options: {
  run: (vars: TVars, reason: string) => Promise<TResult>;
  success: string | ((result: TResult) => string);
  invalidate: QueryKey[];
  onDone?: (result: TResult) => void;
}) {
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [pending, setPending] = React.useState<{ vars: TVars; prompt: Prompt } | null>(null);
  const mutation = useMutation({
    mutationFn: (v: { vars: TVars; reason: string }) => options.run(v.vars, v.reason),
    onSuccess: (result) => {
      setPending(null);
      toast({
        tone: 'success',
        title: typeof options.success === 'function' ? options.success(result) : options.success,
      });
      for (const queryKey of options.invalidate) void qc.invalidateQueries({ queryKey });
      // Every mutation also writes the audit trail.
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      options.onDone?.(result);
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const dialog = pending ? (
    <ConfirmWithReason
      open
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      {...pending.prompt}
      pending={mutation.isPending}
      onConfirm={(reason) => mutation.mutate({ vars: pending.vars, reason })}
    />
  ) : null;
  return {
    ask: (vars: TVars, prompt: Prompt) => setPending({ vars, prompt }),
    dialog,
    isPending: mutation.isPending,
  };
}
