const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Minimal ULID (48-bit time + 80-bit randomness, Crockford base32). `random` is injectable for deterministic tests. */
export function ulid(now: number = Date.now(), random: () => number = Math.random): string {
  let time = '';
  let t = Math.floor(now);
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ALPHABET[Math.floor(random() * 32) % 32];
  return time + rand;
}

export const newId = (prefix: string, now?: number, random?: () => number): string =>
  `${prefix}_${ulid(now, random)}`;
