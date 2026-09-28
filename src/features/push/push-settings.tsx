'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BellRing, Send, Smartphone } from 'lucide-react';
import type { z } from 'zod';
import type { PushPreferencesBody, PushPreferencesDto, QuietHoursDto } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { isApiError } from '@/lib/api/errors';
import { track } from '@/lib/analytics';
import { toast } from '@/stores/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle, Skeleton } from '@/components/ui/misc';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useCareerId } from '@/features/game/hooks';
import { IosInstallDialog } from '@/features/platform/install-app';
import { pushApi } from './api';
import { disablePush, enablePush, hasPushSubscription } from './controller';
import { deniedHelpFor, pushDeviceStatus, type PushDeviceStatus } from './decide';
import { readPushEnvironment, type PushEnvironment } from './environment';
import { serverPushEnabled, useEnableFeedback, usePushConfig } from './hooks';
import { DeniedHelpText } from './push-prompt';
import { usePushStore } from './store';
import { requestNotificationPermission } from './subscription';

type PreferencesBody = z.infer<typeof PushPreferencesBody>;

const STATUS_LABEL: Record<PushDeviceStatus, string> = {
  loading: 'loading',
  unavailable: 'unavailable',
  'in-app': 'inApp',
  'ios-install': 'iosInstall',
  unsupported: 'unsupported',
  denied: 'denied',
  on: 'on',
  off: 'off',
};
const STATUS_TONE: Record<PushDeviceStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  loading: 'neutral',
  unavailable: 'neutral',
  'in-app': 'neutral',
  'ios-install': 'warning',
  unsupported: 'neutral',
  denied: 'danger',
  on: 'success',
  off: 'neutral',
};

/** The device's IANA time zone: quiet hours follow the clock of the device the player is holding. */
export const deviceTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
  } catch {
    return 'Europe/Rome';
  }
};

function Row({
  title,
  hint,
  control,
  htmlFor,
  testId,
}: {
  title: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
  htmlFor?: string;
  testId?: string;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-3" data-testid={testId}>
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm font-semibold">
            {title}
          </label>
        ) : (
          <p className="text-sm font-semibold">{title}</p>
        )}
        {hint ? <div className="text-muted text-xs">{hint}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/** This device: permission, subscription, and the switch that turns push on / off here. */
function usePushDevice() {
  const config = usePushConfig();
  const optedOut = usePushStore((s) => s.optedOut);
  // A silent (re)subscription of the game runtime lands here too: the card reads the browser again when it happens.
  const synced = usePushStore((s) => s.synced);
  // Rendered on the client only (under the game runtime): the browser can be read during render.
  const [env, setEnv] = React.useState<PushEnvironment>(() => readPushEnvironment());
  // Bumped after every change made from here, so the subscription is read again.
  const [revision, setRevision] = React.useState(0);
  const [subscribed, setSubscribed] = React.useState<boolean | null>(null);
  const refresh = React.useCallback(() => {
    setEnv(readPushEnvironment());
    setRevision((r) => r + 1);
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    const readable = env.supported && env.permission === 'granted';
    void (readable ? hasPushSubscription() : Promise.resolve(false)).then((value) => {
      if (!cancelled) setSubscribed(value);
    });
    return () => {
      cancelled = true;
    };
  }, [env, revision, synced]);
  React.useEffect(() => {
    // A permission changed in the browser's site settings shows up without a reload where the browser reports it.
    let status: PermissionStatus | null = null;
    let cancelled = false;
    navigator.permissions
      ?.query({ name: 'notifications' as PermissionName })
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.onchange = refresh;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, [refresh]);
  const serverEnabled = config.data ? serverPushEnabled(config.data) : config.isError ? false : null;
  return {
    config,
    env,
    serverEnabled,
    refresh,
    status: pushDeviceStatus({ serverEnabled, env, subscribed, optedOut }),
  };
}

/** Settings → "Notifiche push" (D-98): this device, what to receive, quiet hours, a test push. */
export function PushSettings() {
  const t = useTranslations('push.settings');
  const tcat = useTranslations('push.categories');
  const tr = useTranslations('push.result');
  const careerId = useCareerId();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const feedback = useEnableFeedback();
  const { config, env, serverEnabled, refresh, status } = usePushDevice();
  const [busy, setBusy] = React.useState(false);
  const [iosOpen, setIosOpen] = React.useState(false);
  const deviceSwitchId = React.useId();

  const preferences = useQuery({
    queryKey: qk.pushPreferences(careerId),
    queryFn: () => pushApi.preferences(careerId),
    enabled: serverEnabled === true,
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: (body: PreferencesBody) => pushApi.updatePreferences(careerId, body),
    onMutate: async (body) => {
      const key = qk.pushPreferences(careerId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PushPreferencesDto>(key);
      if (previous)
        qc.setQueryData<PushPreferencesDto>(key, {
          categories: previous.categories.map(
            (c) => body.categories?.find((next) => next.code === c.code) ?? c,
          ),
          quietHours: body.quietHours ?? previous.quietHours,
        });
      return { previous };
    },
    onError: (error, _body, context) => {
      if (context?.previous) qc.setQueryData(qk.pushPreferences(careerId), context.previous);
      const reason = isApiError(error, 'VALIDATION_ERROR')
        ? (error.details as { reason?: unknown } | null)?.reason
        : null;
      toast({
        tone: 'danger',
        title:
          reason === 'EMPTY_QUIET_HOURS'
            ? t('quietSame')
            : reason === 'INVALID_TIME_ZONE'
              ? t('quietZoneInvalid')
              : errorMessage(error),
      });
    },
    onSuccess: (saved) => qc.setQueryData(qk.pushPreferences(careerId), saved),
  });
  const test = useMutation({
    mutationFn: () => pushApi.test(careerId),
    onSuccess: ({ sent }) => {
      track('push_test_sent', { count: sent });
      if (sent > 0)
        toast({ tone: 'success', title: t('testSent'), description: t('testSentBody', { count: sent }) });
      else toast({ tone: 'warning', title: t('testNone') });
    },
    onError: (error) => toast({ tone: 'danger', title: errorMessage(error) }),
  });

  const onDeviceChange = (on: boolean) => {
    if (busy || !config.data) return;
    if (on) {
      // Inside the gesture, before any await: the browser shows its prompt only in response to a tap.
      const permission = requestNotificationPermission();
      setBusy(true);
      void enablePush(permission, { careerId, config: config.data })
        .then((result) => feedback(result, 'settings'))
        .finally(() => {
          setBusy(false);
          refresh();
        });
      return;
    }
    setBusy(true);
    void disablePush(careerId)
      .then(() => {
        track('push_disabled', { source: 'settings' });
        toast({ tone: 'info', title: tr('disabled') });
      })
      .finally(() => {
        setBusy(false);
        refresh();
      });
  };

  const statusHint: React.ReactNode =
    status === 'unavailable'
      ? t('hint.unavailable')
      : status === 'unsupported'
        ? t('hint.unsupported')
        : status === 'in-app'
          ? t('hint.inApp')
          : status === 'ios-install'
            ? t('hint.iosInstall')
            : status === 'denied'
              ? t('hint.denied')
              : t('deviceHint');

  return (
    <Card className="divide-border divide-y" data-testid="push-settings" data-status={status}>
      <SectionTitle
        action={
          <Badge tone={STATUS_TONE[status]} data-testid="push-status">
            {t(`status.${STATUS_LABEL[status]}`)}
          </Badge>
        }
      >
        {t('title')}
      </SectionTitle>
      <Row
        title={t('device')}
        hint={statusHint}
        htmlFor={deviceSwitchId}
        testId="push-device-row"
        control={
          status === 'loading' ? (
            <Skeleton className="h-6 w-11 rounded-full" />
          ) : (
            <Switch
              id={deviceSwitchId}
              checked={status === 'on'}
              disabled={busy || (status !== 'on' && status !== 'off')}
              onCheckedChange={onDeviceChange}
              aria-label={t('device')}
              data-testid="push-device-toggle"
            />
          )
        }
      />
      {status === 'denied' && env ? (
        <div className="py-3">
          <DeniedHelpText help={deniedHelpFor(env)} />
        </div>
      ) : null}
      {status === 'ios-install' ? (
        <div className="py-3">
          <Button
            variant="secondary"
            className="h-11 lg:h-10"
            onClick={() => setIosOpen(true)}
            data-testid="push-ios-install"
          >
            <Smartphone className="size-4" aria-hidden />
            {t('installHow')}
          </Button>
          <IosInstallDialog open={iosOpen} onOpenChange={setIosOpen} />
        </div>
      ) : null}
      {status === 'on' ? (
        <div className="py-3">
          <Button
            variant="secondary"
            className="h-11 lg:h-10"
            onClick={() => test.mutate()}
            loading={test.isPending}
            data-testid="push-test"
          >
            <Send className="size-4" aria-hidden />
            {t('test')}
          </Button>
        </div>
      ) : null}
      {serverEnabled && config.data ? (
        <PushPreferencesSection
          categories={config.data.categories}
          preferences={preferences.data}
          onSave={(body) => save.mutate(body)}
          // A category added by a newer server than this client still gets a row, under its code.
          categoryLabel={(code) =>
            tcat.has(`${code}.label`)
              ? { label: tcat(`${code}.label`), hint: tcat(`${code}.hint`) }
              : { label: code, hint: '' }
          }
        />
      ) : null}
    </Card>
  );
}

function PushPreferencesSection({
  categories,
  preferences,
  onSave,
  categoryLabel,
}: {
  categories: { code: string; defaultEnabled: boolean }[];
  preferences: PushPreferencesDto | undefined;
  onSave: (body: PreferencesBody) => void;
  categoryLabel: (code: string) => { label: string; hint: string };
}) {
  const t = useTranslations('push.settings');
  if (!preferences)
    return (
      <div className="py-3">
        <Skeleton className="h-24" />
      </div>
    );
  return (
    <>
      <div className="py-3" data-testid="push-categories">
        <p className="text-sm font-semibold">
          <BellRing className="text-skyline mr-1.5 inline size-4 align-[-2px]" aria-hidden />
          {t('categories')}
        </p>
        <p className="text-muted text-xs">{t('categoriesHint')}</p>
        <div className="divide-border mt-1 divide-y">
          {categories.map(({ code, defaultEnabled }) => {
            const { label, hint } = categoryLabel(code);
            const enabled = preferences.categories.find((c) => c.code === code)?.enabled ?? defaultEnabled;
            return (
              <Row
                key={code}
                title={label}
                hint={hint}
                testId={`push-category-${code}`}
                control={
                  <Switch
                    checked={enabled}
                    onCheckedChange={(value) => {
                      track('settings_changed', { setting: `push.${code}`, value });
                      onSave({ categories: [{ code: code as never, enabled: value }] });
                    }}
                    aria-label={label}
                    data-testid={`push-category-toggle-${code}`}
                  />
                }
              />
            );
          })}
        </div>
      </div>
      <QuietHoursEditor value={preferences.quietHours} onSave={(quietHours) => onSave({ quietHours })} />
    </>
  );
}

/** Quiet hours: a switch and two times, saved in the device's time zone (the window may cross midnight). */
function QuietHoursEditor({
  value,
  onSave,
}: {
  value: QuietHoursDto;
  onSave: (quietHours: QuietHoursDto) => void;
}) {
  const t = useTranslations('push.settings');
  const fromId = React.useId();
  const toId = React.useId();
  const zone = React.useMemo(() => deviceTimeZone(), []);
  // The times being edited. Seeded once from the saved window and never reset under the player's fingers (moving from
  // "Dalle" to "Alle" saves the first one, and the answer must not wipe what is being typed in the second).
  const [draft, setDraft] = React.useState({ start: value.start, end: value.end });
  const same = value.enabled && draft.start === draft.end;
  const commit = (next: { start: string; end: string }) => {
    if (!/^\d{2}:\d{2}$/.test(next.start) || !/^\d{2}:\d{2}$/.test(next.end) || next.start === next.end)
      return;
    if (next.start === value.start && next.end === value.end && value.timeZone === zone) return;
    track('settings_changed', { setting: 'push.quietHours', value: true });
    onSave({ enabled: true, start: next.start, end: next.end, timeZone: zone });
  };
  return (
    <div className="pb-3" data-testid="push-quiet-hours">
      <Row
        title={t('quiet')}
        hint={t('quietHint')}
        control={
          <Switch
            checked={value.enabled}
            onCheckedChange={(enabled) => {
              track('settings_changed', { setting: 'push.quietHours', value: enabled });
              onSave({ ...value, ...draft, enabled, timeZone: zone });
            }}
            aria-label={t('quiet')}
            data-testid="push-quiet-toggle"
          />
        }
      />
      {value.enabled ? (
        <div className="flex flex-col gap-2 pb-1">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['start', fromId, t('quietFrom')],
                ['end', toId, t('quietTo')],
              ] as const
            ).map(([field, id, label]) => (
              <div key={field} className="flex flex-col gap-1.5">
                <label htmlFor={id} className="text-muted text-xs font-semibold tracking-wide uppercase">
                  {label}
                </label>
                <Input
                  id={id}
                  type="time"
                  step={300}
                  value={draft[field]}
                  invalid={same}
                  onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                  onBlur={() => commit(draft)}
                  data-testid={`push-quiet-${field}`}
                />
              </div>
            ))}
          </div>
          {same ? (
            <p role="alert" className="text-danger text-xs">
              {t('quietSame')}
            </p>
          ) : (
            <p className="text-subtle text-xs" data-testid="push-quiet-zone">
              {t('quietTimeZone', { zone })}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
