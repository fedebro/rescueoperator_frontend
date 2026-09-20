/**
 * Product analytics facade (owner: platform agent). Feature code only ever calls `track(name, props)`:
 * consent, batching and transport live behind it (`src/features/platform/analytics-client.ts` installs the sink).
 *
 * NO PII, ever: props are ids, catalog codes, enums, counts and durations. `sanitizeProps` enforces it with an
 * allow-list of keys and a strict value grammar (no spaces, no `@`, ≤ 64 chars), so an email, a director name or
 * free text can never leave the device even if a caller passes it by mistake.
 */
export type AnalyticsProps = Record<string, string | number | boolean | null>;

type Layout = 'desktop' | 'mobile';
type Id = string;
type Code = string;
/** Integer credits as a decimal string (the wire format of amounts) or a plain number. */
type AmountProp = string | number;

/**
 * The typed event catalogue: Master Plan §17 + monetization/onboarding addendum §20 + go-to-market addendum §39
 * + the platform events of the client itself. Areas fire their own events through `track()`.
 */
export interface AnalyticsEventProps {
  /* ── acquisition & sign-up funnel ── */
  landing_view: { source?: Code };
  ad_landing_view: { campaign?: Code; source?: Code };
  share_link_opened: { kind?: 'invite' | 'report'; code?: Code };
  account_started: Record<string, never>;
  registration_started: { locale?: Code };
  otp_requested: { resend?: boolean };
  otp_verified: { isNewUser?: boolean };
  location_selected: { locationId: Id };
  hq_selected: { locationId?: Id; siteId: Id; family?: Code };
  career_created: { careerId?: Id; locationId?: Id };
  /* ── session & tutorial ── */
  session_start: { level: number; layout: Layout; standalone: boolean; returning: boolean };
  screen_view: { screen: Code };
  tutorial_step: { step: Code };
  tutorial_completed: Record<string, never>;
  tutorial_skipped: { step?: Code };
  /* ── core loop ── */
  first_incident: { templateCode: Code; severity: number };
  incident_viewed: { incidentId: Id; templateCode: Code; severity: number; status: Code };
  first_dispatch: { incidentId: Id; vehicleCount: number };
  dispatch_sent: { incidentId: Id; templateCode: Code; severity: number; vehicleCount: number };
  first_mission_started: { incidentId: Id; templateCode: Code };
  first_mission_completed: { incidentId: Id; result: Code; stars: number };
  incident_resolved: {
    incidentId: Id;
    templateCode: Code;
    severity: number;
    result?: Code;
    stars?: number;
    responseSeconds?: number;
    durationSeconds?: number;
  };
  incident_failed: { incidentId: Id; templateCode: Code; severity: number };
  incident_expired: { incidentId: Id; templateCode: Code; severity: number };
  vehicle_recalled: { vehicleId: Id; typeCode?: Code };
  duty_changed: { onDuty: boolean };
  /* ── economy & progression ── */
  credits_earned: { amount: AmountProp; source: Code };
  credits_spent: { amount: AmountProp; reason: Code };
  vehicle_bought: { typeCode: Code; family: Code; facilityId?: Id };
  first_upgrade: { facilityId?: Id; upgradeCode: Code };
  upgrade_started: { facilityId: Id; upgradeCode: Code };
  facility_acquired: { facilityTypeCode: Code; siteId?: Id };
  level_up: { level: number };
  unlock_granted: { count: number; code?: Code };
  milestone_claimed: { code: Code };
  stipend_paid: { amount: AmountProp };
  /* ── depth areas ── */
  personnel_hired: { roleCode: Code; count?: number };
  training_started: { courseCode: Code };
  patient_transported: { patientId?: Id; triage?: Code; hospitalId?: Id };
  supplies_ordered: { itemCode?: Code; count?: number };
  maintenance_started: { vehicleId: Id; kind: Code };
  /* ── monetization ── */
  insufficient_credits_shown: { missing?: AmountProp; context?: Code };
  credit_store_opened: { source?: Code };
  credit_purchase_started: { packageCode: Code };
  credit_purchase_completed: { packageCode: Code; status?: Code };
  rewarded_ad_offered: { placement?: Code };
  rewarded_ad_started: { placement?: Code };
  rewarded_ad_completed: { placement?: Code; amount?: AmountProp };
  speedup_used: { target: Code; targetId?: Id; cost?: AmountProp };
  /* ── referral & virality ── */
  referral_panel_opened: Record<string, never>;
  referral_link_created: Record<string, never>;
  referral_shared: { channel: Code };
  referral_signup: Record<string, never>;
  referral_activated: Record<string, never>;
  referral_rewarded: { amount?: AmountProp };
  rescue_report_generated: { incidentId?: Id };
  rescue_report_shared: { channel: Code; incidentId?: Id };
  /* ── platform ── */
  notification_received: { category: Code; priority: Code };
  notification_opened: { notificationId: Id; category: Code; priority: Code; action: Code };
  notifications_read_all: { count: number };
  settings_changed: { setting: Code; value: string | number | boolean };
  pwa_install_prompted: { platform: 'native' | 'ios'; source: 'hint' | 'settings' };
  pwa_install_accepted: Record<string, never>;
  pwa_install_dismissed: { source: 'hint' | 'settings' | 'native' };
  pwa_installed: Record<string, never>;
}
export type AnalyticsEventName = keyof AnalyticsEventProps;

/** Runtime copy of the catalogue names (tests, admin tooling). Kept exhaustive by the `satisfies` clause. */
export const ANALYTICS_EVENT_NAMES = [
  'landing_view',
  'ad_landing_view',
  'share_link_opened',
  'account_started',
  'registration_started',
  'otp_requested',
  'otp_verified',
  'location_selected',
  'hq_selected',
  'career_created',
  'session_start',
  'screen_view',
  'tutorial_step',
  'tutorial_completed',
  'tutorial_skipped',
  'first_incident',
  'incident_viewed',
  'first_dispatch',
  'dispatch_sent',
  'first_mission_started',
  'first_mission_completed',
  'incident_resolved',
  'incident_failed',
  'incident_expired',
  'vehicle_recalled',
  'duty_changed',
  'credits_earned',
  'credits_spent',
  'vehicle_bought',
  'first_upgrade',
  'upgrade_started',
  'facility_acquired',
  'level_up',
  'unlock_granted',
  'milestone_claimed',
  'stipend_paid',
  'personnel_hired',
  'training_started',
  'patient_transported',
  'supplies_ordered',
  'maintenance_started',
  'insufficient_credits_shown',
  'credit_store_opened',
  'credit_purchase_started',
  'credit_purchase_completed',
  'rewarded_ad_offered',
  'rewarded_ad_started',
  'rewarded_ad_completed',
  'speedup_used',
  'referral_panel_opened',
  'referral_link_created',
  'referral_shared',
  'referral_signup',
  'referral_activated',
  'referral_rewarded',
  'rescue_report_generated',
  'rescue_report_shared',
  'notification_received',
  'notification_opened',
  'notifications_read_all',
  'settings_changed',
  'pwa_install_prompted',
  'pwa_install_accepted',
  'pwa_install_dismissed',
  'pwa_installed',
] as const satisfies readonly AnalyticsEventName[];

/* ───────────────────────────── PII guard ───────────────────────────── */

/** Exact prop keys that may be sent. Anything else must match `ALLOWED_KEY_SUFFIX`. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'source',
  'campaign',
  'kind',
  'code',
  'locale',
  'resend',
  'isNewUser',
  'family',
  'level',
  'layout',
  'standalone',
  'returning',
  'screen',
  'step',
  'severity',
  'status',
  'result',
  'stars',
  'onDuty',
  'amount',
  'reason',
  'count',
  'triage',
  'missing',
  'context',
  'placement',
  'target',
  'cost',
  'channel',
  'category',
  'priority',
  'action',
  'setting',
  'value',
  'platform',
  'tier',
  'slot',
  'domain',
  'tab',
  'filter',
  'success',
  'sid',
]);
/** Conventional suffixes of non-personal keys: ids, catalog codes, counters, durations. */
const ALLOWED_KEY_SUFFIX = /^[a-z][A-Za-z0-9]{0,30}(Id|Code|Type|Kind|Count|Seconds|Ms|Level|Index|Status)$/;
/** Keys that are never acceptable, whatever their suffix. */
const FORBIDDEN_WORDS: ReadonlySet<string> = new Set([
  'email',
  'mail',
  'name',
  'text',
  'message',
  'query',
  'search',
  'address',
  'phone',
  'token',
  'password',
  'otp',
  'ip',
]);
/** camelCase / snake_case → lower-case words, so `directorName` is caught while `context` or `recipientId` are not. */
const keyWords = (key: string): string[] => key.split(/(?=[A-Z])|_/).map((w) => w.toLowerCase());
/** ids, enums, codes, amounts: one token, no whitespace, no `@`. */
const SAFE_STRING = /^[A-Za-z0-9][A-Za-z0-9_.:|/+-]{0,63}$/;

export function isAllowedKey(key: string): boolean {
  if (keyWords(key).some((w) => FORBIDDEN_WORDS.has(w))) return false;
  return ALLOWED_KEYS.has(key) || ALLOWED_KEY_SUFFIX.test(key);
}

/** Drops every prop that is not on the allow-list or whose value is not an id/enum/number/boolean. */
export function sanitizeProps(props: Record<string, unknown> | undefined): AnalyticsProps | undefined {
  if (!props) return undefined;
  const out: AnalyticsProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (!isAllowedKey(key)) continue;
    if (value === null || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'string' && SAFE_STRING.test(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Event names are snake_case identifiers ≤ 64 chars (contract limit). */
export function isValidEventName(name: string): boolean {
  return /^[a-z][a-z0-9_]{1,63}$/.test(name);
}

/* ───────────────────────────── facade ───────────────────────────── */

type Sink = (name: string, props?: AnalyticsProps) => void;
let sink: Sink = () => undefined;
export function setAnalyticsSink(next: Sink): void {
  sink = next;
}

/** Typed for catalogue events; any other snake_case name is still accepted (areas may add events before the catalogue does). */
export function track<N extends AnalyticsEventName>(name: N, props?: AnalyticsEventProps[N]): void;
export function track(name: string, props?: AnalyticsProps): void;
export function track(name: string, props?: Record<string, unknown>): void {
  try {
    sink(name, props as AnalyticsProps | undefined);
  } catch {
    /* analytics must never break the game */
  }
}
