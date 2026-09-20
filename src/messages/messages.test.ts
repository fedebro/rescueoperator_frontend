import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import { loadMessagesSync } from '@/test/messages';
import { ErrorCode, IncidentStatus, VehicleStatus, WeatherCode } from '@/contracts';
import { INCIDENT_TEMPLATES, VEHICLE_TYPES, FACILITY_TYPES, CAPABILITIES } from '@/mocks/data/catalog';

type Tree = { [k: string]: Tree | string };
const flatten = (t: Tree, p = '', out: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries(t)) {
    const key = p ? `${p}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
};
const ref = flatten(loadMessagesSync('it') as Tree);
const locales = Object.fromEntries(['en', 'fr', 'de', 'es'].map((l) => [l, loadMessagesSync(l)])) as Record<
  string,
  Tree
>;

describe('message files', () => {
  it.each(Object.keys(locales))('%s has exactly the Italian key set', (l) => {
    expect(Object.keys(flatten(locales[l]!)).sort()).toEqual(Object.keys(ref).sort());
  });
  it.each(['it', ...Object.keys(locales)])(
    '%s: every message is valid ICU and free of ASCII apostrophes',
    (l) => {
      const flat = l === 'it' ? ref : flatten(locales[l]!);
      for (const [key, value] of Object.entries(flat)) {
        expect(() => new IntlMessageFormat(value, l), key).not.toThrow();
        expect(value.includes("'"), `${l}:${key}`).toBe(false);
      }
    },
  );
  it.each(Object.keys(locales))('%s is really translated (≤ 3%% identical to Italian)', (l) => {
    const flat = flatten(locales[l]!);
    const same = Object.keys(ref).filter((k) => flat[k] === ref[k]).length;
    expect(same / Object.keys(ref).length).toBeLessThan(0.03);
  });
  it('covers every enum value the UI renders', () => {
    for (const code of ErrorCode.options) expect(ref[`errors.${code}`], code).toBeTruthy();
    for (const s of IncidentStatus.options) expect(ref[`status.incident.${s}`], s).toBeTruthy();
    for (const s of VehicleStatus.options) expect(ref[`status.vehicle.${s}`], s).toBeTruthy();
    for (const w of WeatherCode.options) expect(ref[`game.world.weather.${w}`], w).toBeTruthy();
  });
  it('covers families, capabilities and domains client-side (fallback while the catalog bundle loads)', () => {
    for (const c of CAPABILITIES) expect(ref[`catalog.capability.${c.code}`], c.code).toBeTruthy();
    for (const f of ['FIRE', 'EMS', 'POLICE', 'WILDFIRE', 'ALPINE', 'UNG'])
      expect(ref[`catalog.family.${f}`], f).toBeTruthy();
  });
  it.each(['it', 'en', 'fr', 'de', 'es'])('catalog bundle %s covers the whole catalog', async (l) => {
    const bundle = (await import(`../mocks/data/generated/i18n/${l}.json`)) as {
      default: { messages: Record<string, string | string[]> };
    };
    const m = bundle.default.messages;
    for (const v of VEHICLE_TYPES) expect(m[`vehicle.${v.code}.name`], v.code).toBeTruthy();
    for (const f of FACILITY_TYPES) expect(m[`facility.${f.code}.name`], f.code).toBeTruthy();
    for (const t of INCIDENT_TEMPLATES) {
      expect(m[`incident.${t.code}.title`], t.code).toBeTruthy();
      expect(Array.isArray(m[`incident.${t.code}.report.intros`]), t.code).toBe(true);
    }
  });
});
