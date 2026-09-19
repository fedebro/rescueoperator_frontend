import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import it_ from './it.json';
import en from './en.json';
import fr from './fr.json';
import de from './de.json';
import es from './es.json';
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
const ref = flatten(it_ as Tree);
const locales = { en, fr, de, es } as Record<string, Tree>;

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
  it('covers the whole mock catalog', () => {
    for (const v of VEHICLE_TYPES) {
      expect(ref[`catalog.vehicle.${v.code}.name`], v.code).toBeTruthy();
      expect(ref[`catalog.vehicle.${v.code}.description`], v.code).toBeTruthy();
    }
    for (const f of FACILITY_TYPES) expect(ref[`catalog.facility.${f.code}.name`], f.code).toBeTruthy();
    for (const c of CAPABILITIES) expect(ref[`catalog.capability.${c}`], c).toBeTruthy();
    for (const t of INCIDENT_TEMPLATES) {
      expect(ref[`incidents.${t.code}.title`], t.code).toBeTruthy();
      expect(ref[`incidents.${t.code}.report`], t.code).toBeTruthy();
    }
  });
});
