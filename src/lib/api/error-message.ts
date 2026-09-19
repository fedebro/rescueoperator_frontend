'use client';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { ApiClientError } from './errors';

/** Maps any thrown value to a translated, player-facing sentence (errors.<CODE>, falling back to errors.UNKNOWN). */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  return React.useCallback(
    (error) => {
      if (error instanceof ApiClientError && t.has(error.code as never)) return t(error.code as never);
      return t('UNKNOWN');
    },
    [t],
  );
}
