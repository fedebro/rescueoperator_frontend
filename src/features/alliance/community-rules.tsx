'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { moderationApi } from '@/lib/api/alliance';
import { qk } from '@/lib/api/query-keys';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { resolveCatalogText, useCatalogMessages } from '@/i18n/catalog-texts';
import { env } from '@/lib/env';
import { useAllianceMutation, useCommunityRules } from './hooks';

const RULE_KEYS = ['respect', 'content', 'personalData', 'noLinks', 'stayInGame', 'report'] as const;
/** The four notes after the rules (consequences, how to report, minors, contact). */
const NOTE_KEYS = ['consequences', 'report', 'minors', 'contact'] as const;

/**
 * Regole della comunità (study 04 §2.1, 09 §7): the screen to accept before the first message, always reachable from the
 * section. Versioned: a new version asks again. The text is a sober draft until the legal validation (A1).
 */
export function CommunityRulesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('alliance.rules');
  const tc = useTranslations('common');
  const locale = useLocale();
  const rules = useCommunityRules();
  // The texts are the backend catalog's `community.rules.*` (one source with the landing, versioned); the client
  // messages carry the same draft as a fallback while the bundle is on its way.
  const catalog = useCatalogMessages();
  const fromBundle = (key: string, params?: Record<string, string | number>) =>
    resolveCatalogText(catalog, { key: `community.rules.${key}`, params });
  const accept = useAllianceMutation(
    (_careerId, version: string) => moderationApi.acceptCommunityRules({ version }),
    {
      invalidate: () => [qk.communityRules],
      successToast: t('acceptedToast'),
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={fromBundle('title') ?? t('title')}
        closeLabel={tc('close')}
        aria-describedby={undefined}
      >
        <div className="scroll-y flex min-h-0 flex-col gap-3 px-4 pb-2 text-sm" data-testid="community-rules">
          <p className="text-muted">{fromBundle('intro') ?? t('intro')}</p>
          <ol className="flex flex-col gap-2">
            {RULE_KEYS.map((key, i) => (
              <li key={key} className="flex gap-3">
                <span className="tabular text-subtle shrink-0">{i + 1}.</span>
                <span>
                  {fromBundle('items', { index: i }) ?? fromBundle(`items.${i}`) ?? t(`items.${key}`)}
                </span>
              </li>
            ))}
          </ol>
          {NOTE_KEYS.map((key) => (
            <p key={key} className="text-muted" data-testid={`rules-note-${key}`}>
              <span className="text-fg font-semibold">{t(`labels.${key}`)}</span>{' '}
              {fromBundle(key) ?? t(`notes.${key}`)}
            </p>
          ))}
          <a
            href={`${env.landingUrl}/legal/community`}
            target="_blank"
            rel="noreferrer"
            className="text-link text-xs underline-offset-2 hover:underline"
            data-testid="rules-full-version"
          >
            {t('fullVersion')}
          </a>
          {rules.isPending ? (
            <Skeleton className="h-6 w-48" />
          ) : rules.data ? (
            <p className="text-subtle flex flex-wrap items-center gap-2 text-xs">
              <span>{t('version', { version: rules.data.version })}</span>
              {rules.data.accepted && rules.data.acceptedAt ? (
                <Badge tone="success" data-testid="rules-accepted">
                  <ShieldCheck className="size-3" aria-hidden />
                  {t('accepted', { date: formatDateTime(rules.data.acceptedAt, locale) })}
                </Badge>
              ) : (
                <span className="text-warning font-semibold">{t('required')}</span>
              )}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc('close')}
          </Button>
          {rules.data && !rules.data.accepted ? (
            <Button
              onClick={() => accept.mutate(rules.data!.version)}
              loading={accept.isPending}
              data-testid="rules-accept"
            >
              {t('accept')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
