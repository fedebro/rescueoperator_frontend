/**
 * Invite-code hand-off between the public invite page (or the landing CTA `…/auth?ref=CODE`) and sign-up.
 * The code is "strictly necessary" data the visitor asked for (the bonus), so it needs no marketing consent.
 * Contract: it travels as `attribution.referralCode` (≤16 chars) in `POST /auth/otp/request`.
 */
const STORAGE_KEY = 'rc-invite-code';
/** Read by the in-browser mock at career creation (the mock's core OTP handler does not forward the attribution). */
const MOCK_HANDOFF_KEY = 'rc-invite-code-sent';
const MAX_AGE_MS = 30 * 24 * 3600_000;
const CODE_PATTERN = /^[A-Za-z0-9_-]{4,16}$/;

interface StoredInvite {
  code: string;
  at: number;
}
const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const isValidInviteCode = (code: string): boolean => CODE_PATTERN.test(code);

export function rememberInviteCode(code: string, now: number = Date.now()): boolean {
  if (!isValidInviteCode(code)) return false;
  try {
    storage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({ code: code.toUpperCase(), at: now } satisfies StoredInvite),
    );
    return true;
  } catch {
    return false;
  }
}

export function readInviteCode(now: number = Date.now()): string | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredInvite>;
    if (typeof parsed.code !== 'string' || typeof parsed.at !== 'number') return null;
    if (!isValidInviteCode(parsed.code) || now - parsed.at > MAX_AGE_MS) return null;
    return parsed.code;
  } catch {
    return null;
  }
}

/** `/auth?ref=CODE` (landing CTA): remember the code. Returns it when present and valid. */
export function captureInviteCodeFromUrl(search: string): string | null {
  const code = new URLSearchParams(search).get('ref');
  return code && rememberInviteCode(code) ? code.toUpperCase() : null;
}

/** Spread into the OTP request body: `{ attribution: { referralCode } }` or nothing. */
export function inviteAttribution(): { attribution?: { referralCode: string } } {
  const code = readInviteCode();
  return code ? { attribution: { referralCode: code } } : {};
}

/** After a successful sign-in the code has done its job; for a NEW user it is parked for the mock backend. */
export function settleInviteCode(isNewUser: boolean): void {
  const store = storage();
  if (!store) return;
  try {
    const code = readInviteCode();
    if (code && isNewUser) store.setItem(MOCK_HANDOFF_KEY, code);
    store.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}
