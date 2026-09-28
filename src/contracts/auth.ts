import { z } from 'zod';
import { IsoDateTime, SupportedLocale, publicId, IdPrefix } from './common';

export const DirectorName = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[\p{L}\p{N} ._'-]+$/u);

export const Attribution = z
  .object({
    source: z.string().max(64).optional(),
    medium: z.string().max(64).optional(),
    campaign: z.string().max(128).optional(),
    creative: z.string().max(128).optional(),
    landingVariant: z.string().max(64).optional(),
    city: z.string().max(64).optional(),
    referralCode: z.string().max(16).optional(),
  })
  .strict();

/** POST /auth/otp/request — always 202 with the same body (anti-enumeration). */
export const OtpRequestBody = z.object({
  email: z.string().email().max(254),
  locale: SupportedLocale.optional(),
  attribution: Attribution.optional(),
  captchaToken: z.string().optional(),
});
export const OtpRequestResult = z.object({
  challengeId: z.string(),
  maskedEmail: z.string(),
  expiresAt: IsoDateTime,
  resendAvailableAt: IsoDateTime,
});

/** POST /auth/otp/verify — sets the refresh cookie, returns the access token. */
export const OtpVerifyBody = z.object({
  challengeId: z.string(),
  code: z.string().regex(/^\d{6}$/),
  /** Required only when the account does not exist yet; server answers DIRECTOR_NAME_REQUIRED otherwise. */
  directorName: DirectorName.optional(),
  acceptTerms: z.boolean().optional(),
  confirmAge: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
});

export const PlatformRole = z.enum(['USER', 'SUPPORT', 'GAME_ADMIN', 'SUPER_ADMIN']);

export const UserDto = z.object({
  id: publicId(IdPrefix.user),
  email: z.string().email(),
  directorName: z.string(),
  locale: SupportedLocale,
  roles: z.array(PlatformRole),
  createdAt: IsoDateTime,
  activeCareerId: publicId(IdPrefix.career).nullable(),
});
export type UserDto = z.infer<typeof UserDto>;

export const AuthResult = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: IsoDateTime,
  user: UserDto,
  isNewUser: z.boolean(),
});
export type AuthResult = z.infer<typeof AuthResult>;

/** POST /auth/refresh (cookie) → AuthResult · POST /auth/logout → 204 · GET /me → UserDto */
/**
 * POST /auth/logout — optional body (additive, web push D-97…D-99): `pushEndpoint` = this device's push subscription endpoint,
 * deleted together with the session (scoped to the session's user; works even with an expired access token). No body = as before.
 */
export const LogoutBody = z.object({ pushEndpoint: z.string().min(1).max(2048).optional() });
export const UpdateMeBody = z.object({
  directorName: DirectorName.optional(),
  locale: SupportedLocale.optional(),
  marketingConsent: z.boolean().optional(),
});

export const SessionDto = z.object({
  id: z.string(),
  current: z.boolean(),
  userAgent: z.string().nullable(),
  createdAt: IsoDateTime,
  lastUsedAt: IsoDateTime,
});
