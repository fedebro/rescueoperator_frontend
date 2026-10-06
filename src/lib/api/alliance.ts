/**
 * REST wrappers of the alliance system (contracts/alliances.ts, moderation.ts, account.ts; study 08 §6). Every response
 * shape is the contract copy in `@/contracts`. Owned by the frontend agent (brief 00-regole-comuni.md §1).
 */
import { z } from 'zod';
import {
  AidColumnDto,
  AidColumnOptionsDto,
  AidRequestDto,
  AllianceChannelDto,
  AllianceMessageDto,
  AlliancePostDto,
  AlliancePostReplyDto,
  AlliancePresenceDto,
  AllianceUnreadDto,
  type AlliancePostKind,
  type CreateAlliancePostBody,
  type CreateAllianceReplyBody,
  type MarkChannelReadBody,
  type PinPostBody,
  type ReactToPostBody,
  type SendAidColumnBody,
  type SendAllianceMessageBody,
  type UpdateAlliancePostBody,
  type AcceptCommunityRulesBody,
  AccountDeletionDto,
  AccountExportDto,
  AllianceCardDto,
  AllianceHomeDto,
  AllianceInviteDto,
  AllianceJoinRequestDto,
  AllianceLogEntryDto,
  AllianceMemberDto,
  AllianceSyncDelta,
  BlockDto,
  CommunityRulesDto,
  type CreateAllianceInviteBody,
  type CreateBlockBody,
  type CreateReportBody,
  type DecideJoinRequestBody,
  DirectorCardDto,
  type FoundAllianceBody,
  type JoinAllianceBody,
  JoinAllianceResult,
  LeaveAllianceResult,
  type MuteMemberBody,
  MyAllianceDto,
  ProfileSettingsDto,
  PublicAllianceInviteDto,
  type RemoveMemberBody,
  ReportDto,
  type SetMemberRoleBody,
  type SupportedLocale,
  type TransferLeadershipBody,
  type UpdateAllianceSettingsBody,
  type UpdateProfileBody,
  type AllianceJoinPolicy,
  AllianceObjectivesDto,
  AllianceXpEntryDto,
  AllianceRankingDto,
  AllianceOperationDto,
} from '@/contracts';
import { api } from './client';

const c = (careerId: string) => `/careers/${careerId}`;
const a = (careerId: string) => `${c(careerId)}/alliance`;

export interface AllianceSearchParams {
  q?: string;
  language?: SupportedLocale;
  joinPolicy?: AllianceJoinPolicy;
  hasSlots?: boolean;
  cursor?: string | null;
  limit?: number;
}

export const allianceApi = {
  /* ── the section ── */
  home: (careerId: string) => api.get(a(careerId), { schema: AllianceHomeDto }),
  /** `GET …/alliance/sync[?since]` — the alliance stream's replay (or the current seq without `since`). */
  sync: (careerId: string, since?: number) =>
    api.get(`${a(careerId)}/sync`, {
      schema: AllianceSyncDelta,
      query: since === undefined ? undefined : { since },
    }),

  /* ── find ── */
  search: (params: AllianceSearchParams) =>
    api.getPage(`/alliances`, {
      schema: z.array(AllianceCardDto),
      query: {
        q: params.q || undefined,
        language: params.language,
        joinPolicy: params.joinPolicy,
        hasSlots: params.hasSlots ? true : undefined,
        cursor: params.cursor ?? undefined,
        limit: params.limit,
      },
    }),
  card: (allianceId: string) => api.get(`/alliances/${allianceId}`, { schema: AllianceCardDto }),
  publicInvite: (code: string) =>
    api.get(`/public/alliance-invite/${encodeURIComponent(code)}`, {
      schema: PublicAllianceInviteDto,
      auth: false,
    }),

  /* ── membership commands (★) ── */
  found: (careerId: string, body: FoundAllianceBody) =>
    api.command(a(careerId), body, { schema: MyAllianceDto }),
  join: (careerId: string, body: JoinAllianceBody) =>
    api.command(`${a(careerId)}/join`, body, { schema: JoinAllianceResult }),
  leave: (careerId: string) => api.command(`${a(careerId)}/leave`, {}, { schema: LeaveAllianceResult }),
  updateSettings: (careerId: string, body: UpdateAllianceSettingsBody) =>
    api.patch(`${a(careerId)}/settings`, body, { schema: MyAllianceDto }),
  transfer: (careerId: string, body: TransferLeadershipBody) =>
    api.command(`${a(careerId)}/transfer`, body, { schema: MyAllianceDto }),
  disband: (careerId: string) => api.command(`${a(careerId)}/disband`, {}, { schema: MyAllianceDto }),
  cancelDisband: (careerId: string) =>
    api.command(`${a(careerId)}/disband/cancel`, {}, { schema: MyAllianceDto }),

  /* ── members ── */
  members: (careerId: string, status?: 'ACTIVE' | 'BANNED') =>
    api.get(`${a(careerId)}/members`, { schema: z.array(AllianceMemberDto), query: { status } }),
  setRole: (careerId: string, memberId: string, body: SetMemberRoleBody) =>
    api.command(`${a(careerId)}/members/${memberId}/role`, body, { schema: AllianceMemberDto }),
  remove: (careerId: string, memberId: string, body: RemoveMemberBody) =>
    api.command<void>(`${a(careerId)}/members/${memberId}/remove`, body),
  mute: (careerId: string, memberId: string, body: MuteMemberBody) =>
    api.command(`${a(careerId)}/members/${memberId}/mute`, body, { schema: AllianceMemberDto }),
  unmute: (careerId: string, memberId: string) =>
    api.command(`${a(careerId)}/members/${memberId}/unmute`, {}, { schema: AllianceMemberDto }),

  /* ── invites & join requests ── */
  invites: (careerId: string) => api.get(`${a(careerId)}/invites`, { schema: z.array(AllianceInviteDto) }),
  createInvite: (careerId: string, body: CreateAllianceInviteBody) =>
    api.command(`${a(careerId)}/invites`, body, { schema: AllianceInviteDto }),
  /** Revoke an invite of my alliance — or, for a direct invite addressed to ME, decline it (same route, backend notes). */
  revokeInvite: (careerId: string, inviteId: string) => api.delete(`${a(careerId)}/invites/${inviteId}`),
  joinRequests: (careerId: string) =>
    api.get(`${a(careerId)}/join-requests`, { schema: z.array(AllianceJoinRequestDto) }),
  decide: (careerId: string, requestId: string, body: DecideJoinRequestBody) =>
    api.command(`${a(careerId)}/join-requests/${requestId}/decide`, body, { schema: AllianceJoinRequestDto }),
  /** My own pending request, withdrawn. */
  withdrawRequest: (careerId: string, requestId: string) =>
    api.delete(`${a(careerId)}/join-requests/${requestId}`),

  /* ── log (high roles) ── */
  log: (careerId: string, cursor?: string | null) =>
    api.getPage(`${a(careerId)}/log`, {
      schema: z.array(AllianceLogEntryDto),
      query: { cursor: cursor ?? undefined },
    }),

  /* ── Director card & privacy (module `profiles`) ── */
  director: (careerId: string) => api.get(`/directors/${careerId}`, { schema: DirectorCardDto }),
  /** Directors found by name (direct invites). Cards of registered players: never fleet, credits or positions. */
  searchDirectors: (q: string) => api.get(`/directors`, { schema: z.array(DirectorCardDto), query: { q } }),
  profile: () => api.get('/me/profile', { schema: ProfileSettingsDto }),
  updateProfile: (body: UpdateProfileBody) => api.patch('/me/profile', body, { schema: ProfileSettingsDto }),
};

/** Player side of the moderation contract (platform agent): blocks, reports, community rules. */
export const moderationApi = {
  blocks: (careerId: string) => api.get(`${c(careerId)}/blocks`, { schema: z.array(BlockDto) }),
  block: (careerId: string, body: CreateBlockBody) =>
    api.command(`${c(careerId)}/blocks`, body, { schema: BlockDto }),
  unblock: (careerId: string, blockId: string) => api.delete(`${c(careerId)}/blocks/${blockId}`),
  report: (careerId: string, body: CreateReportBody) =>
    api.command(`${c(careerId)}/reports`, body, { schema: ReportDto }),
  myReports: (careerId: string) => api.get(`${c(careerId)}/reports`, { schema: z.array(ReportDto) }),
  communityRules: () => api.get('/me/community-rules', { schema: CommunityRulesDto }),
  acceptCommunityRules: (body: AcceptCommunityRulesBody) =>
    api.command('/me/community-rules/accept', body, { schema: CommunityRulesDto }),
};

/** Account lifecycle (platform agent): the real deletion and the export. */
export const accountApi = {
  requestDeletion: () => api.command('/me/delete', {}, { schema: AccountDeletionDto }),
  export: () => api.get('/me/export', { schema: AccountExportDto }),
};

/* ───────────────────────────── phase 2: board, chat, aid ───────────────────────────── */

/** Bacheca (contracts/alliance-board.ts): posts with pinned announcements first, replies, reactions, pins, the read marker. */
export const boardApi = {
  posts: (careerId: string, cursor?: string | null, kind?: AlliancePostKind) =>
    api.getPage(`${a(careerId)}/posts`, {
      schema: z.array(AlliancePostDto),
      query: { cursor: cursor ?? undefined, kind },
    }),
  post: (careerId: string, postId: string) =>
    api.get(`${a(careerId)}/posts/${postId}`, { schema: AlliancePostDto }),
  create: (careerId: string, body: CreateAlliancePostBody) =>
    api.command(`${a(careerId)}/posts`, body, { schema: AlliancePostDto }),
  update: (careerId: string, postId: string, body: UpdateAlliancePostBody) =>
    api.patch(`${a(careerId)}/posts/${postId}`, body, { schema: AlliancePostDto }),
  remove: (careerId: string, postId: string) => api.delete(`${a(careerId)}/posts/${postId}`),
  replies: (careerId: string, postId: string, cursor?: string | null) =>
    api.getPage(`${a(careerId)}/posts/${postId}/replies`, {
      schema: z.array(AlliancePostReplyDto),
      query: { cursor: cursor ?? undefined, limit: 100 },
    }),
  reply: (careerId: string, postId: string, body: CreateAllianceReplyBody) =>
    api.command(`${a(careerId)}/posts/${postId}/replies`, body, { schema: AlliancePostReplyDto }),
  removeReply: (careerId: string, postId: string, replyId: string) =>
    api.delete(`${a(careerId)}/posts/${postId}/replies/${replyId}`),
  react: (careerId: string, postId: string, body: ReactToPostBody) =>
    api.command(`${a(careerId)}/posts/${postId}/reactions`, body, { schema: AlliancePostDto }),
  pin: (careerId: string, postId: string, body: PinPostBody) =>
    api.command(`${a(careerId)}/posts/${postId}/pin`, body, { schema: AlliancePostDto }),
  read: (careerId: string) => api.command(`${a(careerId)}/board/read`, {}, { schema: AllianceUnreadDto }),
};

/** Chat (contracts/alliance-chat.ts): channels, pages of messages towards older, send, delete, read marker, presence. */
export const chatApi = {
  channels: (careerId: string) => api.get(`${a(careerId)}/channels`, { schema: z.array(AllianceChannelDto) }),
  messages: (careerId: string, channelId: string, cursor?: string | null) =>
    api.getPage(`${a(careerId)}/channels/${channelId}/messages`, {
      schema: z.array(AllianceMessageDto),
      query: { cursor: cursor ?? undefined, limit: 50 },
    }),
  send: (careerId: string, channelId: string, body: SendAllianceMessageBody, idempotencyKey?: string) =>
    api.command(`${a(careerId)}/channels/${channelId}/messages`, body, {
      schema: AllianceMessageDto,
      idempotent: idempotencyKey ?? true,
    }),
  remove: (careerId: string, messageId: string) => api.delete(`${a(careerId)}/messages/${messageId}`),
  read: (careerId: string, channelId: string, body: MarkChannelReadBody = {}) =>
    api.command(`${a(careerId)}/channels/${channelId}/read`, body, { schema: AllianceUnreadDto }),
  presence: (careerId: string) =>
    api.get(`${a(careerId)}/presence`, { schema: z.array(AlliancePresenceDto) }),
};

/** Mutuo soccorso (contracts/alliance-aid.ts): requests, columns, the column composer's options, recall. */
export const aidApi = {
  requests: (careerId: string, status: 'OPEN' | 'ALL' = 'OPEN', cursor?: string | null) =>
    api.getPage(`${a(careerId)}/aid-requests`, {
      schema: z.array(AidRequestDto),
      query: { status, cursor: cursor ?? undefined },
    }),
  request: (careerId: string, requestId: string) =>
    api.get(`${a(careerId)}/aid-requests/${requestId}`, { schema: AidRequestDto }),
  columns: (
    careerId: string,
    role: 'GIVEN' | 'RECEIVED' | 'ALL' = 'ALL',
    active?: boolean,
    cursor?: string | null,
  ) =>
    api.getPage(`${a(careerId)}/aid-columns`, {
      schema: z.array(AidColumnDto),
      query: { role, active: active ? true : undefined, cursor: cursor ?? undefined },
    }),
  columnOptions: (careerId: string, requestId: string) =>
    api.get(`${a(careerId)}/aid-requests/${requestId}/column-options`, { schema: AidColumnOptionsDto }),
  /** ★ no body: the server lists the gaps itself (05 §2.2). */
  requestForIncident: (careerId: string, incidentId: string) =>
    api.command(`${c(careerId)}/incidents/${incidentId}/aid-request`, {}, { schema: AidRequestDto }),
  requestForMajor: (careerId: string, majorId: string) =>
    api.command(`${c(careerId)}/major-incidents/${majorId}/aid-request`, {}, { schema: AidRequestDto }),
  cancel: (careerId: string, requestId: string) =>
    api.command(`${a(careerId)}/aid-requests/${requestId}/cancel`, {}, { schema: AidRequestDto }),
  sendColumn: (careerId: string, requestId: string, body: SendAidColumnBody) =>
    api.command(`${a(careerId)}/aid-requests/${requestId}/columns`, body, { schema: AidColumnDto }),
  recall: (careerId: string, columnId: string) =>
    api.command(`${a(careerId)}/aid-columns/${columnId}/recall`, {}, { schema: AidColumnDto }),
};

/** Progression (study 06): objectives, the XP ledger, the weekly ranking (`GET /alliances/ranking`, bearer). */
export const progressApi = {
  objectives: (careerId: string) =>
    api.get(`${a(careerId)}/objectives`, { schema: AllianceObjectivesDto.nullable() }),
  xp: (careerId: string, cursor?: string | null) =>
    api.getPage(`${a(careerId)}/xp`, {
      schema: z.array(AllianceXpEntryDto),
      query: { cursor: cursor ?? undefined, limit: 50 },
    }),
  ranking: () => api.get('/alliances/ranking', { schema: AllianceRankingDto }),
};

/** Alliance operations (study 07): the running / recent one, the history, Partecipa / Non ora. */
export const operationApi = {
  current: (careerId: string) =>
    api.get(`${a(careerId)}/operation`, { schema: AllianceOperationDto.nullable() }),
  history: (careerId: string, cursor?: string | null) =>
    api.getPage(`${a(careerId)}/operations`, {
      schema: z.array(AllianceOperationDto),
      query: { cursor: cursor ?? undefined, limit: 20 },
    }),
  join: (careerId: string) =>
    api.command(`${a(careerId)}/operation/join`, {}, { schema: AllianceOperationDto }),
  decline: (careerId: string) =>
    api.command(`${a(careerId)}/operation/decline`, {}, { schema: AllianceOperationDto }),
};
