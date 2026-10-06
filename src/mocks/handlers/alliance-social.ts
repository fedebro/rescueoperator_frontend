import { http } from 'msw';
import { allianceSocialOf } from '../domains/alliance-social';
import type { DomainHandlers } from './kit';

/** REST handlers of the board and the chat (backend notes §1a routes; `…` = /careers/:careerId/alliance). */
export const allianceSocialHandlers: DomainHandlers = ({
  engine,
  url,
  ok,
  route,
  command,
  careerOf,
  noContent,
  query,
  C,
}) => {
  const api = () => allianceSocialOf(engine);
  const A = `${C}/alliance`;
  const paged = <T>(page: { data: T[]; nextCursor: string | null; hasMore: boolean }) =>
    ok(page.data, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } });
  return [
    /* ── board ── */
    http.get(
      url(`${A}/posts`),
      route((ctx) => {
        const q = query(ctx);
        return paged(
          api().listPosts(careerOf(ctx), {
            cursor: q.get('cursor') ?? undefined,
            limit: q.get('limit') ? Number(q.get('limit')) : undefined,
            kind: q.get('kind') ?? undefined,
          }),
        );
      }),
    ),
    http.post(
      url(`${A}/posts`),
      command((_ctx, body, career) => api().createPost(career, body), 201),
    ),
    http.post(
      url(`${A}/board/read`),
      command((_ctx, _body, career) => api().readBoard(career)),
    ),
    http.get(
      url(`${A}/posts/:postId`),
      route((ctx) => ok(api().getPost(careerOf(ctx), String(ctx.params.postId)))),
    ),
    http.patch(
      url(`${A}/posts/:postId`),
      route((ctx, body) => ok(api().updatePost(careerOf(ctx), String(ctx.params.postId), body))),
    ),
    http.delete(
      url(`${A}/posts/:postId`),
      route((ctx) => {
        api().deletePost(careerOf(ctx), String(ctx.params.postId));
        return noContent();
      }),
    ),
    http.get(
      url(`${A}/posts/:postId/replies`),
      route((ctx) => {
        const q = query(ctx);
        return paged(
          api().listReplies(careerOf(ctx), String(ctx.params.postId), {
            cursor: q.get('cursor') ?? undefined,
            limit: q.get('limit') ? Number(q.get('limit')) : undefined,
          }),
        );
      }),
    ),
    http.post(
      url(`${A}/posts/:postId/replies`),
      command((ctx, body, career) => api().createReply(career, String(ctx.params.postId), body), 201),
    ),
    http.delete(
      url(`${A}/posts/:postId/replies/:replyId`),
      route((ctx) => {
        api().deleteReply(careerOf(ctx), String(ctx.params.postId), String(ctx.params.replyId));
        return noContent();
      }),
    ),
    http.post(
      url(`${A}/posts/:postId/reactions`),
      command((ctx, body, career) => api().react(career, String(ctx.params.postId), body)),
    ),
    http.post(
      url(`${A}/posts/:postId/pin`),
      command((ctx, body, career) => api().pin(career, String(ctx.params.postId), body)),
    ),

    /* ── chat ── */
    http.get(
      url(`${A}/channels`),
      route((ctx) => ok(api().listChannels(careerOf(ctx)))),
    ),
    http.get(
      url(`${A}/channels/:channelId/messages`),
      route((ctx) => {
        const q = query(ctx);
        return paged(
          api().listMessages(careerOf(ctx), String(ctx.params.channelId), {
            cursor: q.get('cursor') ?? undefined,
            limit: q.get('limit') ? Number(q.get('limit')) : undefined,
          }),
        );
      }),
    ),
    http.post(
      url(`${A}/channels/:channelId/messages`),
      command((ctx, body, career) => api().sendMessage(career, String(ctx.params.channelId), body), 201),
    ),
    http.post(
      url(`${A}/channels/:channelId/read`),
      command((ctx, body, career) => api().readChannel(career, String(ctx.params.channelId), body)),
    ),
    http.delete(
      url(`${A}/messages/:messageId`),
      route((ctx) => {
        api().deleteMessage(careerOf(ctx), String(ctx.params.messageId));
        return noContent();
      }),
    ),
    http.get(
      url(`${A}/presence`),
      route((ctx) => ok(api().presence(careerOf(ctx)))),
    ),
  ];
};
