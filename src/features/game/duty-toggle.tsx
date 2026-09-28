'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { SyncSnapshot } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { toast } from '@/stores/toast';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useCareerId, useSnapshot } from './hooks';

/**
 * On duty = the server generates incidents for this career. Off duty = started processes finish, nothing new spawns.
 * One place per layout (03 §2.9): the sheet's summary row below 1024 px, the top bar on desktop (+ Settings).
 */
export function DutyToggle({ compact }: { compact?: boolean }) {
  const careerId = useCareerId();
  const { career } = useSnapshot();
  const t = useTranslations('game.duty');
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const id = React.useId();
  const mutation = useMutation({
    mutationFn: (onDuty: boolean) => gameApi.setDuty(careerId, onDuty),
    onMutate: (onDuty) => {
      qc.setQueryData<SyncSnapshot>(qk.sync(careerId), (s) =>
        s ? { ...s, career: { ...s.career, onDuty } } : s,
      );
    },
    onSuccess: (summary) => {
      qc.setQueryData<SyncSnapshot>(qk.sync(careerId), (s) =>
        s ? { ...s, career: { ...s.career, onDuty: summary.onDuty } } : s,
      );
    },
    onError: (e, onDuty) => {
      qc.setQueryData<SyncSnapshot>(qk.sync(careerId), (s) =>
        s ? { ...s, career: { ...s.career, onDuty: !onDuty } } : s,
      );
      toast({ tone: 'danger', title: errorMessage(e) });
    },
  });
  // Compact (sheet summary row on phones, top bar on desktop): the label and the switch are one 44 px target.
  if (compact)
    return (
      <label
        htmlFor={id}
        className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold"
        data-testid="duty-control"
      >
        <span className={career.onDuty ? 'text-success' : 'text-muted'}>
          {career.onDuty ? t('on') : t('off')}
        </span>
        <Switch
          id={id}
          checked={career.onDuty}
          onCheckedChange={(v) => mutation.mutate(v)}
          data-testid="duty-toggle"
        />
      </label>
    );
  return (
    <div className="border-border bg-surface-2 flex items-center justify-between gap-2 rounded-md border p-3">
      <label htmlFor={id} className="flex cursor-pointer flex-col">
        <span className={cn('font-semibold', career.onDuty ? 'text-success' : 'text-muted')}>
          {career.onDuty ? t('on') : t('off')}
        </span>
        <span className="text-muted text-xs">{career.onDuty ? t('onHint') : t('offHint')}</span>
      </label>
      <Switch
        id={id}
        checked={career.onDuty}
        onCheckedChange={(v) => mutation.mutate(v)}
        data-testid="duty-toggle"
      />
    </div>
  );
}
