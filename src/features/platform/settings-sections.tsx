'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Volume2 } from 'lucide-react';
import { track } from '@/lib/analytics';
import { playCue } from '@/lib/sound';
import { analyticsAllowed, soundEnabled, useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { InstallAppSetting } from './install-app';

function Row({
  title,
  hint,
  control,
  htmlFor,
}: {
  title: string;
  hint?: string;
  control: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm font-semibold">
            {title}
          </label>
        ) : (
          <p className="text-sm font-semibold">{title}</p>
        )}
        {hint ? <p className="text-muted text-xs">{hint}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/** Master switch, volume and the two cue categories. Every change is audible immediately (it is a user gesture). */
export function SoundSettings() {
  const t = useTranslations('platform.sound');
  const ts = useTranslations('settings');
  const s = useSettingsStore();
  const on = soundEnabled(s.sound);
  const volumeId = React.useId();
  const percent = Math.round(s.soundVolume * 100);
  const preview = (overrides: Partial<Parameters<typeof playCue>[1] & object> = {}) =>
    playCue('confirm', {
      enabled: true,
      volume: s.soundVolume,
      alerts: true,
      feedback: true,
      ...overrides,
    });
  return (
    <Card className="divide-border divide-y" data-testid="sound-settings">
      <SectionTitle>{t('title')}</SectionTitle>
      <Row
        title={ts('sound')}
        hint={t('masterHint')}
        control={
          <Switch
            checked={on}
            onCheckedChange={(value) => {
              s.setSound(value);
              track('settings_changed', { setting: 'sound', value });
              if (value) preview();
            }}
            aria-label={ts('sound')}
            data-testid="sound-toggle"
          />
        }
      />
      <Row
        title={t('volume')}
        hint={t('volumeValue', { percent })}
        htmlFor={volumeId}
        control={
          <input
            id={volumeId}
            type="range"
            min={0}
            max={100}
            step={5}
            value={percent}
            disabled={!on}
            onChange={(e) => s.setSoundVolume(Number(e.target.value) / 100)}
            // Commit (pointer up / key up): one analytics event and one preview per adjustment, not per pixel.
            onPointerUp={() => {
              track('settings_changed', { setting: 'soundVolume', value: percent });
              preview();
            }}
            onKeyUp={() => {
              track('settings_changed', { setting: 'soundVolume', value: percent });
              preview();
            }}
            aria-valuetext={t('volumeValue', { percent })}
            data-testid="sound-volume"
            className="accent-skyline h-11 w-36 disabled:opacity-45 lg:w-44"
          />
        }
      />
      <Row
        title={t('alerts')}
        hint={t('alertsHint')}
        control={
          <Switch
            checked={s.soundAlerts}
            disabled={!on}
            onCheckedChange={(value) => {
              s.setSoundCategory('alerts', value);
              track('settings_changed', { setting: 'soundAlerts', value });
            }}
            aria-label={t('alerts')}
            data-testid="sound-alerts-toggle"
          />
        }
      />
      <Row
        title={t('feedback')}
        hint={t('feedbackHint')}
        control={
          <Switch
            checked={s.soundFeedback}
            disabled={!on}
            onCheckedChange={(value) => {
              s.setSoundCategory('feedback', value);
              track('settings_changed', { setting: 'soundFeedback', value });
            }}
            aria-label={t('feedback')}
            data-testid="sound-feedback-toggle"
          />
        }
      />
      <div className="py-3">
        <Button
          variant="secondary"
          className="h-11 lg:h-10"
          disabled={!on}
          onClick={() =>
            playCue('incident.high', { enabled: true, volume: s.soundVolume, alerts: true, feedback: true })
          }
          data-testid="sound-test"
        >
          <Volume2 className="size-4" aria-hidden />
          {t('test')}
        </Button>
      </div>
    </Card>
  );
}

/** Product analytics consent (opt-in) + install entry. */
export function PrivacyAndAppSettings() {
  const t = useTranslations('platform');
  const consent = useSettingsStore((s) => s.analyticsConsent);
  const setConsent = useSettingsStore((s) => s.setAnalyticsConsent);
  return (
    <Card className="divide-border divide-y" data-testid="privacy-settings">
      <SectionTitle>{t('privacy.title')}</SectionTitle>
      <Row
        title={t('privacy.analytics')}
        hint={t('privacy.analyticsHint')}
        control={
          <Switch
            checked={analyticsAllowed(consent)}
            onCheckedChange={(value) => {
              // Order matters: the opt-in is recorded first so that this very event is the first one collected,
              // and an opt-out is never reported (nothing may leave the device after it).
              setConsent(value);
              if (value) track('settings_changed', { setting: 'analyticsConsent', value: true });
            }}
            aria-label={t('privacy.analytics')}
            data-testid="analytics-consent-toggle"
          />
        }
      />
      <InstallAppSetting />
    </Card>
  );
}
