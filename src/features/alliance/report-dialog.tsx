'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Flag } from 'lucide-react';
import { ReportReason, type ReportTargetKind } from '@/contracts';
import { moderationApi } from '@/lib/api/alliance';
import { qk } from '@/lib/api/query-keys';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAllianceMutation } from './hooks';

export interface ReportTarget {
  kind: ReportTargetKind;
  id: string;
  /** What is being reported, for the dialog's subtitle (a message excerpt, a Director's name…). */
  label?: string;
}

const NOTE_MAX = 500;

/**
 * Segnala (study 04 §2.3, 09 §7): the reasons of the moderation contract, an optional note, a confirmation. The outcome
 * reaches the reporter through the notifications centre. One case per target: a repeat returns the same case.
 */
export function ReportDialog({
  target,
  onOpenChange,
}: {
  target: ReportTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('alliance.report');
  const tc = useTranslations('common');
  const [reason, setReason] = React.useState<ReportReason | null>(null);
  const [note, setNote] = React.useState('');
  const [done, setDone] = React.useState(false);
  const report = useAllianceMutation(
    (careerId, body: { kind: ReportTargetKind; id: string; reason: ReportReason; note: string }) =>
      moderationApi.report(careerId, {
        targetKind: body.kind,
        targetId: body.id,
        reason: body.reason,
        note: body.note.trim() || undefined,
      }),
    { invalidate: (careerId) => [[...qk.career(careerId), 'reports']], onSuccess: () => setDone(true) },
  );
  const close = (open: boolean) => {
    if (!open) {
      setReason(null);
      setNote('');
      setDone(false);
    }
    onOpenChange(open);
  };
  return (
    <Dialog open={target !== null} onOpenChange={close}>
      <DialogContent
        title={t('title')}
        description={target?.label ? t('about', { label: target.label }) : t('intro')}
        closeLabel={tc('close')}
      >
        {done ? (
          <div className="flex flex-col gap-2 px-4 pb-2 text-sm" data-testid="report-done">
            <p className="font-semibold">{t('sentTitle')}</p>
            <p className="text-muted">{t('sentBody')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-4 pb-2" data-testid="report-form">
            <fieldset>
              <legend className="text-muted mb-1.5 text-xs font-semibold tracking-wide uppercase">
                {t('reason')}
              </legend>
              <div role="radiogroup" aria-label={t('reason')} className="flex flex-col gap-1">
                {ReportReason.options.map((code) => (
                  <label
                    key={code}
                    className="border-border bg-surface-2 has-checked:border-focus flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm pointer-coarse:min-h-11"
                  >
                    <input
                      type="radio"
                      name="report-reason"
                      value={code}
                      checked={reason === code}
                      onChange={() => setReason(code)}
                      className="accent-brand size-4"
                      data-testid={`report-reason-${code}`}
                    />
                    <span>{t(`reasons.${code}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Textarea
              aria-label={t('note')}
              placeholder={t('notePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={NOTE_MAX}
              counter
              rows={2}
              data-testid="report-note"
            />
            <p className="text-subtle text-xs">{t('hint')}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            {done ? tc('close') : tc('cancel')}
          </Button>
          {!done && target ? (
            <Button
              variant="danger"
              disabled={reason === null}
              loading={report.isPending}
              onClick={() => reason && report.mutate({ kind: target.kind, id: target.id, reason, note })}
              data-testid="report-submit"
            >
              <Flag className="size-4" aria-hidden />
              {t('submit')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Blocca (04 §2.3): a confirmation naming the person; the block is immediate and silent for them. */
export function BlockConfirmDialog({
  target,
  onOpenChange,
  onBlocked,
}: {
  target: { careerId: string; directorName: string } | null;
  onOpenChange: (open: boolean) => void;
  onBlocked?: () => void;
}) {
  const t = useTranslations('alliance.director');
  const tc = useTranslations('common');
  const block = useAllianceMutation(
    (careerId, targetCareerId: string) => moderationApi.block(careerId, { careerId: targetCareerId }),
    {
      successToast: t('blockedToast'),
      invalidate: (careerId) => [
        qk.blocks(careerId),
        qk.allianceMembers(careerId),
        qk.allianceChat(careerId),
        qk.allianceBoard(careerId),
      ],
      onSuccess: () => {
        onOpenChange(false);
        onBlocked?.();
      },
    },
  );
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('confirmBlock', { name: target?.directorName ?? '' })}
        description={t('confirmBlockBody')}
        closeLabel={tc('close')}
      >
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            variant="danger"
            loading={block.isPending}
            onClick={() => target && block.mutate(target.careerId)}
            data-testid="confirm-block"
          >
            {t('block')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
