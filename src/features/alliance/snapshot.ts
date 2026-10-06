import { AllianceSnapshotDto, type SyncSnapshot } from '@/contracts';

/**
 * The additive `alliance` field of the career snapshot (`{ id, name, tag, role, unread, operationId } | null`). Read
 * through the schema so a client older or newer than the server never crashes on it; parsed once per snapshot object.
 */
const cache = new WeakMap<object, AllianceSnapshotDto | null>();

export function allianceOf(snapshot: SyncSnapshot): AllianceSnapshotDto | null {
  const hit = cache.get(snapshot);
  if (hit !== undefined) return hit;
  const raw = snapshot.alliance;
  const parsed = raw ? AllianceSnapshotDto.safeParse(raw) : null;
  const value = parsed?.success ? parsed.data : null;
  cache.set(snapshot, value);
  return value;
}

/** A snapshot with the alliance field replaced (the realtime reducers and optimistic reads use it). */
export function withAlliance(snapshot: SyncSnapshot, alliance: AllianceSnapshotDto | null): SyncSnapshot {
  return { ...snapshot, alliance };
}
