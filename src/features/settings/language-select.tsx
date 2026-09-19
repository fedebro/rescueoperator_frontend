'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { SupportedLocale } from '@/contracts';
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES } from '@/i18n/config';
import { authApi } from '@/lib/api/endpoints';
import { useAuthStore } from '@/stores/auth';
import { Select } from '@/components/ui/select';

export function LanguageSelect({ compact }: { compact?: boolean }) {
  const locale = useLocale();
  const t = useTranslations('settings');
  const router = useRouter();
  const authenticated = useAuthStore((s) => s.status === 'authenticated');
  const setUser = useAuthStore((s) => s.setUser);

  const change = (next: string) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    if (authenticated)
      void authApi
        .updateMe({ locale: next as SupportedLocale })
        .then(setUser)
        .catch(() => undefined);
    router.refresh();
  };

  return (
    <Select
      label={t('language')}
      value={locale}
      onValueChange={change}
      className={compact ? 'h-9 min-w-0 gap-1 px-2 text-xs' : undefined}
      options={LOCALES.map((l) => ({ value: l, label: compact ? l.toUpperCase() : LOCALE_NAMES[l] }))}
    />
  );
}
