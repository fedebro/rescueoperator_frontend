import { http } from 'msw';
import {
  acceptCommunityRules,
  block,
  communityRules,
  createReport,
  exportAccount,
  listBlocks,
  myReports,
  mySanctions,
  requestAccountDeletion,
  unblock,
} from '../domains/community';
import type { DomainHandlers } from './kit';

/** Player side of the moderation + account contracts (platform agent's `contracts/moderation.ts`, `account.ts`). */
export const communityHandlers: DomainHandlers = ({
  engine,
  url,
  ok,
  route,
  command,
  authed,
  careerOf,
  noContent,
  C,
}) => [
  http.get(
    url(`${C}/blocks`),
    route((ctx) => ok(listBlocks(engine, careerOf(ctx)))),
  ),
  http.post(
    url(`${C}/blocks`),
    command((_ctx, body, career) => block(engine, career, body.careerId), 201),
  ),
  http.delete(
    url(`${C}/blocks/:blockId`),
    route((ctx) => {
      unblock(engine, careerOf(ctx), String(ctx.params.blockId));
      return noContent();
    }),
  ),
  http.get(
    url(`${C}/reports`),
    route((ctx) => ok(myReports(engine, careerOf(ctx)))),
  ),
  http.post(
    url(`${C}/reports`),
    command((_ctx, body, career) => createReport(engine, career, body), 201),
  ),
  http.get(
    url('/me/community-rules'),
    route((ctx) => ok(communityRules(engine, authed(ctx).user.id))),
  ),
  http.post(
    url('/me/community-rules/accept'),
    route((ctx, body) => ok(acceptCommunityRules(engine, authed(ctx).user.id, body.version))),
  ),
  http.get(
    url('/me/sanctions'),
    route((ctx) => {
      authed(ctx);
      return ok(mySanctions());
    }),
  ),
  // ★POST /me/delete (202): the real deletion. The old /me/delete-request stays as an alias in handlers.ts.
  http.post(
    url('/me/delete'),
    route((ctx) => ok(requestAccountDeletion(engine, authed(ctx).user.email), { status: 202 })),
  ),
  http.get(
    url('/me/export'),
    route((ctx) => ok(exportAccount(engine, authed(ctx).user.email))),
  ),
];
