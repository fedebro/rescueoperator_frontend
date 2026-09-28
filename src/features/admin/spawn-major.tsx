'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { useCatalogMessages } from '@/i18n/catalog-texts';
import { useI18nText } from '@/i18n/use-i18n-text';
import { toast } from '@/stores/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from './shared';

const AUTO = 'AUTO';

/** The major scenarios of the catalog, read from its text bundle (`major.scenario.<CODE>.title`): no list to keep in sync. */
export function majorScenarioCodes(messages: Record<string, unknown>): string[] {
  return Object.keys(messages)
    .map((key) => /^major\.scenario\.(MAJ_[A-Z0-9_]+)\.title$/.exec(key)?.[1])
    .filter((code): code is string => !!code)
    .sort();
}

/**
 * QA / support tool (★POST /admin/careers/:id/major-incident, GAME_ADMIN, audited `major_incident.spawn`): starts a major
 * incident for the career now — a scenario of the catalog or the generator's own pick. 409 while one is already running.
 */
export function SpawnMajorDialog({
  careerId,
  open,
  onOpenChange,
}: {
  careerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('admin.spawnMajor');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const messages = useCatalogMessages();
  const codes = React.useMemo(() => majorScenarioCodes(messages), [messages]);
  const [scenario, setScenario] = React.useState(AUTO);
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const reasonOk = reason.trim().length >= 5;
  const spawn = useMutation({
    mutationFn: () =>
      adminApi.spawnMajor(careerId, {
        scenarioCode: scenario === AUTO ? undefined : scenario,
        reason: reason.trim(),
      }),
    onSuccess: (major) => {
      toast({ tone: 'success', title: t('done'), description: tx(major.title) });
      for (const key of ['incidents', 'careerIncidents', 'career', 'audit', 'dashboard'])
        void qc.invalidateQueries({ queryKey: qk.admin(key) });
      onOpenChange(false);
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => (spawn.isPending ? undefined : onOpenChange(next))}>
      <DialogContent title={t('title')} description={t('subtitle')} closeLabel={tc('close')}>
        <form
          noValidate
          className="flex flex-col gap-4"
          data-testid="admin-spawn-major"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (reasonOk) spawn.mutate();
          }}
        >
          <p className="text-sm">
            <code className="tabular text-muted text-xs break-all select-all">{careerId}</code>
          </p>
          <Field label={t('scenario')} htmlFor="admin-major-scenario">
            <Select
              id="admin-major-scenario"
              label={t('scenario')}
              value={scenario}
              onValueChange={setScenario}
              options={[
                { value: AUTO, label: t('auto') },
                ...codes.map((code) => ({
                  value: code,
                  label: `${tx({ key: `major.scenario.${code}.title` })} · ${code}`,
                })),
              ]}
            />
          </Field>
          <Field
            label={t('reason')}
            htmlFor="admin-major-reason"
            error={touched && !reasonOk ? t('reasonRequired') : null}
          >
            <Textarea
              id="admin-major-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              invalid={touched && !reasonOk}
            />
          </Field>
          <DialogFooter className="mt-0">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={spawn.isPending}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={spawn.isPending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
