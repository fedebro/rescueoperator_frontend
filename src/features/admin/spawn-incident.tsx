'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { toast } from '@/stores/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from './shared';

const AUTO = 'AUTO';

/** QA tool: creates a real incident of a catalog template in the chosen career (optionally at a map position). */
export function SpawnIncidentDialog({
  careerId,
  position,
  open,
  onOpenChange,
}: {
  careerId: string;
  position?: [number, number];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('admin.spawn');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const catalog = useQuery({ queryKey: qk.admin('catalog'), queryFn: adminApi.catalog, staleTime: 600_000 });
  const [filter, setFilter] = React.useState('');
  const [templateCode, setTemplateCode] = React.useState<string>();
  const [severity, setSeverity] = React.useState(AUTO);
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  const templates = React.useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (catalog.data?.sections.templates ?? [])
      .map((e) => ({ entry: e, label: `${name('incident', e.code, 'title')} · ${e.code}` }))
      .filter((x) => !needle || x.label.toLowerCase().includes(needle))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog.data, filter, name]);
  const selected = catalog.data?.sections.templates?.find((e) => e.code === templateCode);
  const min = Number(selected?.attributes.severityMin ?? 1);
  const max = Number(selected?.attributes.severityMax ?? 10);
  const reasonOk = reason.trim().length >= 5;

  const spawn = useMutation({
    mutationFn: () =>
      adminApi.spawnIncident(careerId, {
        templateCode: templateCode!,
        severity: severity === AUTO ? undefined : Number(severity),
        position,
        reason: reason.trim(),
      }),
    onSuccess: (incident) => {
      toast({
        tone: 'success',
        title: t('done'),
        description: incident.id,
      });
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
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (templateCode && reasonOk) spawn.mutate();
          }}
        >
          <p className="text-sm">
            <code className="tabular text-muted text-xs break-all select-all">{careerId}</code>
            {position ? (
              <span className="text-muted ml-2 text-xs">
                {t('at', { lat: position[1].toFixed(5), lng: position[0].toFixed(5) })}
              </span>
            ) : null}
          </p>
          <Field label={t('filter')} htmlFor="admin-spawn-filter">
            <Input
              id="admin-spawn-filter"
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-base lg:text-sm"
            />
          </Field>
          <Field
            label={t('template')}
            htmlFor="admin-spawn-template"
            error={touched && !templateCode ? t('templateRequired') : null}
          >
            <Select
              id="admin-spawn-template"
              label={t('template')}
              value={templateCode}
              onValueChange={(v) => {
                setTemplateCode(v);
                setSeverity(AUTO);
              }}
              placeholder={t('templatePlaceholder')}
              options={templates.map((x) => ({ value: x.entry.code, label: x.label }))}
            />
          </Field>
          <Field label={t('severity')} htmlFor="admin-spawn-severity" hint={t('severityHint')}>
            <Select
              id="admin-spawn-severity"
              label={t('severity')}
              value={severity}
              onValueChange={setSeverity}
              options={[
                { value: AUTO, label: t('severityAuto') },
                ...Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => ({
                  value: String(min + i),
                  label: String(min + i),
                })),
              ]}
            />
          </Field>
          <Field
            label={t('reason')}
            htmlFor="admin-spawn-reason"
            error={touched && !reasonOk ? t('reasonRequired') : null}
          >
            <Textarea
              id="admin-spawn-reason"
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

export function IncidentLink({ id }: { id: string }) {
  return (
    <Link href={`/admin/incidents/${id}`} className="text-skyline hover:underline">
      <code className="tabular text-xs break-all">{id}</code>
    </Link>
  );
}
