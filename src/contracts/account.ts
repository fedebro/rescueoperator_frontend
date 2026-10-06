/**
 * Account lifecycle — study 2026-10-06 §04 §6.2 (D-122), analisi/brief-alleanze/agent-platform.md §Phase 1.5.
 * Real deletion (grace period, then a scheduled job that leaves the alliance, anonymises what the player wrote, deletes the
 * game data and keeps reports / sanctions for their retention) and the export of the player's own data. Additive within v1:
 * new routes, new shapes, one new error code (`ACCOUNT_DELETING`), one optional field on `OtpVerifyBody` (`cancelDeletion`).
 */
import { z } from 'zod';
import { IdPrefix, IsoDateTime, publicId } from './common';

/**
 * ★POST /me/delete → 202 `AccountDeletionDto`. The account goes to `DELETION_REQUESTED`, every session is revoked, the job
 * `ACCOUNT_DELETE` runs at `scheduledAt` (`config.moderation.account.deletionGraceDays`, 7 days). Until then every sign-in
 * answers 403 `ACCOUNT_DELETING` (`details.scheduledAt`); signing in with `OtpVerifyBody.cancelDeletion: true` cancels the
 * deletion and opens the session. Replaces the old `POST /me/delete-request` (kept as an alias).
 */
export const AccountDeletionDto = z.object({
  status: z.literal('DELETION_REQUESTED'),
  requestedAt: IsoDateTime,
  scheduledAt: IsoDateTime,
});
export type AccountDeletionDto = z.infer<typeof AccountDeletionDto>;

/**
 * GET /me/export → `AccountExportDto` (JSON attachment, rate limited: `config.moderation.account.exportsPerDay`). The player's
 * own data: account, careers (summary), what they wrote (posts, replies, messages: provided by the alliance modules), the
 * reports they made, their blocks, their sanctions, their rules acceptances, notifications and ledger. Sections provided by
 * other modules are keyed by module name under `sections`; every value is plain JSON.
 */
export const AccountExportDto = z.object({
  exportedAt: IsoDateTime,
  format: z.literal('rescue-control-account-export/1'),
  user: z.object({
    id: publicId(IdPrefix.user),
    email: z.string(),
    directorName: z.string(),
    locale: z.string(),
    createdAt: IsoDateTime,
    status: z.string(),
    marketingConsent: z.boolean(),
  }),
  careers: z.array(z.object({
    id: publicId(IdPrefix.career),
    status: z.string(),
    level: z.number().int(),
    xpTotal: z.string(),
    reputation: z.number(),
    incidentsResolved: z.number().int(),
    incidentsFailed: z.number().int(),
    createdAt: IsoDateTime,
    locationName: z.string().nullable(),
  })),
  sections: z.record(z.unknown()),
});
export type AccountExportDto = z.infer<typeof AccountExportDto>;
