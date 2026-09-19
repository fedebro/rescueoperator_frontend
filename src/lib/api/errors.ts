import type { ErrorCode } from '@/contracts';

/** Codes produced by the client itself, never by the server. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'ABORTED';
export type ApiErrorCode = ErrorCode | ClientErrorCode;

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(init: {
    code: ApiErrorCode;
    message: string;
    status?: number;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiClientError';
    this.code = init.code;
    this.status = init.status ?? 0;
    this.details = init.details;
    this.requestId = init.requestId ?? null;
  }

  /** True when retrying later may succeed (connectivity / availability), false for business errors. */
  get transient(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT' ||
      this.code === 'SERVICE_UNAVAILABLE' ||
      this.code === 'IDEMPOTENCY_IN_PROGRESS' ||
      this.status >= 502
    );
  }
}

export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiClientError {
  return error instanceof ApiClientError && (code === undefined || error.code === code);
}
