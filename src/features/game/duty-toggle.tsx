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

/** On duty = the server generates incidents for this career. Off duty = started processes finish, nothing new spawns. */
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
  return (
    <div
      className={cn(
        'flex items-center gap-2',
        !compact && 'border-border bg-surface-2 justify-between rounded-md border p-3',
      )}
    >
      <label
        htmlFor={id}
        className={cn('cursor-pointer', compact ? 'text-xs font-semibold' : 'flex flex-col')}
      >
        <span className={cn(career.onDuty ? 'text-success' : 'text-muted', !compact && 'font-semibold')}>
          {career.onDuty ? t('on') : t('off')}
        </span>
        {compact ? null : (
          <span className="text-muted text-xs">{career.onDuty ? t('onHint') : t('offHint')}</span>
        )}
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
