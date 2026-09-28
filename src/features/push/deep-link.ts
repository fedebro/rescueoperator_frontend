import { IdPrefix, PUSH_FOCUS_KINDS, publicId, type PushFocusKind } from '@/contracts';

/** `/game?focus=<kind>:<publicId>` — what a push (or any link) wants the operations map to open. */
export interface FocusTarget {
  kind: PushFocusKind;
  id: string;
}

/** The public id each kind of deep link must carry (`inc_<ULID>`, `mjr_<ULID>`, `veh_<ULID>`, `fac_<ULID>`). */
const ID_SCHEMA = {
  incident: publicId(IdPrefix.incident),
  major: publicId(IdPrefix.majorIncident),
  vehicle: publicId(IdPrefix.vehicle),
  facility: publicId(IdPrefix.facility),
} satisfies Record<PushFocusKind, unknown>;

/** Parses the `focus` query value; anything malformed (unknown kind, an id of another kind) is null. */
export function parseFocusParam(value: string | null | undefined): FocusTarget | null {
  if (!value) return null;
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!(PUSH_FOCUS_KINDS as readonly string[]).includes(kind)) return null;
  return ID_SCHEMA[kind as PushFocusKind].safeParse(id).success ? { kind: kind as PushFocusKind, id } : null;
}

/**
 * A same-origin in-app path from a service-worker message or a notification (`/game?focus=…`). Anything pointing
 * elsewhere (another origin, a `javascript:` URL, garbage) is null.
 */
export function sameOriginPath(raw: unknown, origin: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
