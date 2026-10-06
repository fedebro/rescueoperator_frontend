/**
 * Alliance wire types — one import point for every alliance screen, the api module and the mock.
 *
 * Everything comes from the generated contract copy (`pnpm sync:contracts` → `@/contracts`: alliances.ts, alliance-board.ts,
 * alliance-chat.ts, alliance-aid.ts, alliance-progress.ts, alliance-operations.ts, moderation.ts, account.ts). Only the
 * UI-side helpers that the contract does not define live here.
 */
import type { AllianceMemberRole } from '@/contracts';

export {
  ALLIANCE_DESCRIPTION_MAX,
  ALLIANCE_NAME_MAX,
  ALLIANCE_NAME_MIN,
  ALLIANCE_SOCKET_EVENT,
  ALLIANCE_TABS,
  ALLIANCE_TAG_MAX,
  ALLIANCE_TAG_MIN,
  AllianceCardDto,
  AllianceConfigDto,
  AllianceDescription,
  AllianceEmblemColor,
  AllianceEmblemDto,
  AllianceEmblemShape,
  AllianceEmblemSymbol,
  AllianceHomeDto,
  AllianceInviteDto,
  AllianceInviteReceivedDto,
  AllianceJoinBlock,
  AllianceJoinPolicy,
  AllianceJoinRequestDto,
  AllianceLogAction,
  AllianceLogEntryDto,
  AllianceMemberDto,
  AllianceMemberRole,
  AllianceMemberStatus,
  AllianceMuteDuration,
  AllianceName,
  AllianceNotificationTarget,
  AlliancePresence,
  AllianceRealtimeEnvelope,
  AllianceRealtimeEventType,
  AllianceRestrictionsDto,
  AllianceSettingsDto,
  AllianceSnapshotDto,
  AllianceStatus,
  AllianceSyncDelta,
  AllianceTag,
  CreateAllianceInviteBody,
  DecideJoinRequestBody,
  DirectorCardDto,
  FoundAllianceBody,
  JoinAllianceBody,
  JoinAllianceResult,
  LeaveAllianceResult,
  MuteMemberBody,
  MyAllianceDto,
  MyAllianceJoinRequestDto,
  ProfileSettingsDto,
  PublicAllianceInviteDto,
  RemoveMemberBody,
  SetMemberRoleBody,
  TransferLeadershipBody,
  UpdateAllianceSettingsBody,
  UpdateProfileBody,
  alliancePostTarget,
  allianceAidTarget,
  allianceOperationTarget,
  allianceTarget,
} from '@/contracts';
export type {
  AllianceCardDto as AllianceCard,
  AllianceConfigDto as AllianceConfig,
  AllianceEmblemDto as AllianceEmblem,
  AllianceHomeDto as AllianceHome,
  AllianceInviteDto as AllianceInvite,
  AllianceInviteReceivedDto as AllianceInviteReceived,
  AllianceJoinRequestDto as AllianceJoinRequest,
  AllianceLogEntryDto as AllianceLogEntry,
  AllianceMemberDto as AllianceMember,
  AllianceRealtimeEnvelope as AllianceEnvelope,
  AllianceRestrictionsDto as AllianceRestrictions,
  AllianceSnapshotDto as AllianceSnapshotRef,
  AllianceTab,
  DirectorCardDto as DirectorCard,
  MyAllianceDto as MyAlliance,
  MyAllianceJoinRequestDto as MyAllianceJoinRequest,
  ProfileSettingsDto as ProfileSettings,
  PublicAllianceInviteDto as PublicAllianceInvite,
} from '@/contracts';
export {
  AcceptCommunityRulesBody,
  AccountDeletionDto,
  AccountExportDto,
  BlockDto,
  CommunityRulesDto,
  CreateBlockBody,
  CreateReportBody,
  ReportDto,
  ReportReason,
  ReportTargetKind,
} from '@/contracts';

/** Study 02 §3: the permission matrix in one place (mirrored by the server and by the mock). */
export const ROLE_RANK: Record<AllianceMemberRole, number> = { MEMBER: 0, DEPUTY: 1, COORDINATOR: 2 };
export const isHighRole = (role: AllianceMemberRole): boolean => ROLE_RANK[role] >= ROLE_RANK.DEPUTY;
/** May `actor` remove / mute `target`? Members never; deputies only members; the coordinator everybody but himself. */
export const canActOn = (actor: AllianceMemberRole, target: AllianceMemberRole): boolean =>
  actor === 'COORDINATOR' ? target !== 'COORDINATOR' : actor === 'DEPUTY' && target === 'MEMBER';
