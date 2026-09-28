import { describe, expect, it } from 'vitest';
import catalog from '@/mocks/data/generated/catalog.json';
import { PICTOGRAMS } from '@/design/icons/pictograms';
import { catalogIconName, topdownSvg, vehicleClassOf } from '@/design/icons';
import { clusterPictogramIndex, clusterPictogramKey, imageSvg } from './images';

const expectSvg = (name: string) => {
  const spec = imageSvg(name);
  expect(spec, name).not.toBeNull();
  expect(spec!.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(spec!.svg.endsWith('</svg>')).toBe(true);
  expect(spec!.svg).not.toMatch(/[{}]|undefined|NaN/);
  expect(spec!.width).toBeGreaterThan(0);
  expect(spec!.height).toBeGreaterThan(0);
  return spec!.svg;
};

describe('map images', () => {
  it('draws every vehicle type as the top-down glyph of its class, in the family colour', () => {
    for (const v of catalog.vehicleTypes) {
      const svg = expectSvg(`veh:${v.family}:${v.icon}`);
      expect(svg).toBe(topdownSvg(vehicleClassOf(v.icon), v.family as 'FIRE', 64));
    }
    for (const u of catalog.ungUnitTypes) expectSvg(`veh:UNG:${u.icon}`);
    expect(imageSvg('veh:FIRE:ladder')!.svg).toBe(topdownSvg('ladder', 'FIRE', 64));
    expect(imageSvg('veh:SHARED:ladder')).toBeNull();
  });

  it('draws facilities with the pictogram of their TYPE (code or icon key) and stays compatible with fac:<FAMILY>', () => {
    for (const f of catalog.facilityTypes) {
      const byCode = expectSvg(`fac:${f.family}:${f.code}`);
      expect(byCode).toContain(PICTOGRAMS[catalogIconName(f.icon)]);
      expect(expectSvg(`fac:${f.family}:${f.icon}`)).toBe(byCode);
    }
    expect(expectSvg('fac:EMS')).toContain(PICTOGRAMS.facility_ems);
    expect(expectSvg('fac:EMS:UNKNOWN_TYPE')).toContain(PICTOGRAMS.facility_ems);
    expect(expectSvg('fac:SHARED')).toContain(PICTOGRAMS.facility_coordination);
    expect(imageSvg('fac:NOPE')).toBeNull();
  });

  it('draws incident pins from the template icon key, falling back to the category', () => {
    for (const t of catalog.incidentTemplates) {
      const svg = expectSvg(`inc:${t.category}|${t.icon}:7`);
      expect(svg).toContain(PICTOGRAMS[catalogIconName(t.icon)]);
      expect(svg).toContain('>7</text>');
    }
    expect(expectSvg('inc:MEDICAL:3')).toContain(PICTOGRAMS.cat_medical);
    expect(expectSvg('inc:SOMETHING_NEW:42')).toContain('>10</text>');
  });

  it('draws a cluster as what is inside: the most severe pictogram, its severity ring and the count', () => {
    const fall = catalog.incidentTemplates.find((t) => t.code === 'MED_FALL')!;
    const key = `${fall.category}|${fall.icon}`;
    const index = clusterPictogramIndex(key);
    expect(clusterPictogramIndex(key)).toBe(index);
    expect(clusterPictogramKey(index)).toBe(key);
    const svg = expectSvg(`clu:${index}:8:4`);
    expect(svg).toContain(PICTOGRAMS[catalogIconName(fall.icon)]);
    expect(svg).toContain('stroke="#F0503A"'); // severity 8
    expect(svg).toContain('>4</text>');
    expect(expectSvg(`clu:${index}:3:250`)).toContain('>99+</text>');
    // An index this page never saw (a stale image name): a generic pictogram, never a crash.
    expectSvg('clu:9999:5:2');
  });

  it('marks the pins of a major incident: thick halo and siren on the main scene, thin halo on a linked one', () => {
    const plain = expectSvg('inc:FIRE:6');
    const main = expectSvg('inc:FIRE:6:M');
    const linked = expectSvg('inc:FIRE:3:L');
    const MAJOR = '#FF4F86';
    expect(plain).not.toContain(MAJOR);
    // The halo is drawn under the pin, the siren badge over it (top-left corner).
    expect(main.indexOf(MAJOR)).toBeLessThan(main.indexOf('fill="#0A1220"'));
    expect(main).toMatch(/stroke="#FF4F86" stroke-width="7"/);
    expect(main).toMatch(/<circle cx="9" cy="9" r="8" fill="#FF4F86"/);
    expect(linked).toMatch(/stroke="#FF4F86" stroke-width="5"/);
    expect(linked).not.toMatch(/<circle cx="9" cy="9" r="8" fill="#FF4F86"/);
    // Flags combine: a linked incident on the water keeps its anchor badge.
    expect(expectSvg('inc:WATER:4:WL')).toMatch(/stroke="#FF4F86" stroke-width="5"/);
  });

  it('draws hospitals, candidate sites, closures and starter sites', () => {
    const hospital = expectSvg('hosp');
    expect(hospital).toContain(PICTOGRAMS.hospital);
    // Branding rule: hospitals are an "H" tile, never a (red) cross on white.
    expect(hospital).not.toMatch(/fill="(#fff(fff)?|white)"/i);
    expect(expectSvg('hosp:helipad')).toContain(PICTOGRAMS.helipad);
    for (const family of ['FIRE', 'EMS', 'POLICE', 'WILDFIRE', 'ALPINE']) {
      expect(expectSvg(`cand:${family}`)).toContain(PICTOGRAMS.site_candidate);
      expect(expectSvg(`cand:${family}:1`)).not.toBe(expectSvg(`cand:${family}:0`));
    }
    expect(expectSvg('closure')).toContain(PICTOGRAMS.closure);
    expect(expectSvg('site:0')).not.toBe(expectSvg('site:1'));
    expect(imageSvg('nothing:here')).toBeNull();
  });
});
