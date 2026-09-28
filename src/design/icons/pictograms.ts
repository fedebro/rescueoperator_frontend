import * as mark from './marks';
import type { Mark } from './marks';
import type { PictogramName } from './names';

/*
 * Shared building blocks (kept as plain strings so every entry stays self-contained markup).
 * Side-view road vehicles face RIGHT, share the same wheel line (cy=17, r=2) and the same cab profile.
 */
const WHEELS = '<circle cx="6.5" cy="17" r="2"/><circle cx="17.5" cy="17" r="2"/>';
/** Cab-over truck cab sharing its rear wall with a box body that ends at x=14. */
const CAB_BOX = 'M8.5 17h7M14 10h4.5L22 13.5V17h-2.5';
/** Free-standing cab (rear wall at x=15) for low-deck trucks. */
const CAB_DECK = 'M8.5 17h7M15 17v-7h3.5L22 13.5V17h-2.5';
/** Station-house outline used by every facility_* icon. */
const HOUSE = '<path d="M3 21V9.5L12 3l9 6.5V21z"/>';
/** Two rows of water waves (y=17 and y=21). */
const WAVE_17 = 'M2 17c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0';
const WAVE_21 = 'M2 21c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0';

// ───────────────────────────── bases for composed pictograms (base silhouette + role mark) ─────────────────────────────
const CAR = `<path d="M4.5 17H2v-3.5l2.5-1.5 3-4h7l3.5 4 4 1.5V17h-2.5M8.5 17h7"/><path d="M4.5 12H18M11 8v4"/><path d="M9.5 8V6.5h3V8"/>${WHEELS}`;
const PICKUP = `<path d="M4.5 17H2v-5h8V8h5.5l3 4H22v5h-2.5M8.5 17h7"/><path d="M10 12h8.5M13 8v4"/>${WHEELS}`;
const VAN = `<path d="M4.5 17H2V6.5h13l4.5 5 2.5 1V17h-2.5M8.5 17h7"/><path d="M13 6.5v5h6.5"/>${WHEELS}`;
const TRUCK = `<path d="M4.5 17H2V5h12v12${CAB_BOX}"/>${WHEELS}`;
const AMBULANCE = `<path d="M4.5 17H2V7h13l4.5 4.5 2.5 1V17h-2.5M8.5 17h7"/><path d="M15 7v4.5h4.5"/><path d="M7 7V5.5h3V7"/>${WHEELS}`;
const TANKER_CHASSIS = `<path d="M2.5 17h2${CAB_DECK}"/>${WHEELS}`;
const COMMAND = `<path d="M4.5 17H2V9h17l3 3.5V17h-2.5M8.5 17h7"/><path d="M15 9v3.5h7"/><path d="M6 9V4.5M3.8 2.5a3 3 0 0 0 0 4M8.2 2.5a3 3 0 0 1 0 4"/>${WHEELS}`;
const SUV = `<path d="M4.5 17H2V8.5a1 1 0 0 1 1-1h11.5l3.5 4.5 4 1V17h-2.5M8.5 17h7"/><path d="M4 5.5h9M5.5 5.5v2M11.5 5.5v2"/>${WHEELS}`;
const HELICOPTER =
  '<path d="M9 9h7a5 5 0 0 1 5 5 2 2 0 0 1-2 2h-6a4 4 0 0 1-4-4z"/><path d="M9 10.5H3.5v-3"/><path d="M5 6h16M13 9V6"/><path d="M11 19.5h9M13 16v3.5M17 16v3.5"/><path d="M16 9v3.5h4.8"/>';
/** Service truck of the non-player units: the mark in the box tells the utility. */
const UTILITY = `<path d="M4.5 17H2V6.5h12V17${CAB_BOX}"/><path d="M16 10V8.5h2V10"/>${WHEELS}`;
const PIP = (x: number): string => `<circle cx="${x}" cy="14.4" r="0.9" fill="currentColor" stroke="none"/>`;

/** Marks drawn INSIDE a silhouette use a lighter stroke so they stay open at 20px. */
const fine = (markup: string): string => `<g stroke-width="1.35">${markup}</g>`;
const inTruck = (m: Mark, s = 1.1): string => TRUCK + fine(m(8, 10.3, s));
const inVan = (m: Mark, s = 0.95): string => VAN + fine(m(7.5, 10.7, s));
const inUtility = (m: Mark, s = 1): string => UTILITY + fine(m(8, 10.8, s));
/** Helicopters share one airframe; the role mark sits in the free corner under the tail boom. */
const heliWith = (m: Mark, s = 0.85): string => HELICOPTER + m(5.2, 17.2, s);
/** Pulse line + tier pips (1 = basic, 2 = intermediate, 3 = advanced life support). */
const ambulanceTier = (pips: number[]): string =>
  `${AMBULANCE}<path d="M3.5 10.3h2l1.4-2.5 2 5 1.4-2.5h2.2"/>${pips.map(PIP).join('')}`;

// Facility chains: tier 1 = house, tier 2 = house + vehicle bay, tier 3 = headquarters block with a radio mast,
// tier 4 = special base (small house + a badge: helipad, aircraft, star). The family mark is always inside the building.
const houseWithBay = (m: Mark): string =>
  `<path d="M2 21V10.5L9.5 5l7.5 5.5V21z"/><path d="M17 13h5v8h-5M19.5 21v-4"/>${m(9.5, 15.3, 0.95)}`;
const headquarters = (m: Mark): string =>
  `<path d="M3 21V9.5h18V21z"/><path d="M12 9.5V5M9.4 2.4a3.6 3.6 0 0 0 0 4.6M14.6 2.4a3.6 3.6 0 0 1 0 4.6"/>${m(12, 15.3, 1)}`;
const specialBase = (m: Mark, badge: string): string =>
  `<path d="M2 21.5V12.5l6-4.5 6 4.5v9z"/>${m(8, 16.6, 0.8)}${badge}`;
const BADGE_HELIPAD = '<circle cx="18" cy="6.5" r="4.75"/><path d="M16.3 4.5v4M19.7 4.5v4M16.3 6.5h3.4"/>';
const BADGE_STAR = mark.star(18, 7, 1.15);
const BADGE_PLANE = mark.planeTop(18, 6.8, 1.25);

/** People icons: bust + headgear + the mark of the job in the free top-right corner. */
const SHOULDERS = '<path d="M2.5 21v-1a6.5 6.5 0 0 1 13 0v1"/>';
const BUST_PLAIN = `<circle cx="9" cy="8" r="3.5"/>${SHOULDERS}`;
const BUST_HELMET = `<path d="M5.5 7.5v1a3.5 3.5 0 0 0 7 0v-1M4 7.5h10M5 7.5a4 4 0 0 1 8 0M9 3.5V2.3"/>${SHOULDERS}`;
const BUST_CAP = `<path d="M5.5 6.8v1.7a3.5 3.5 0 0 0 7 0V6.8M5 6.8h9.5M5.2 6.8 4.5 4 9 2.5 13.5 4l-.7 2.8"/>${SHOULDERS}`;
const BUST_HEADSET = `<circle cx="9" cy="8.6" r="3"/><path d="M4.7 10.3V7.2a4.3 4.3 0 0 1 8.6 0v3.1M13.3 10.5c0 1.7-.9 2.5-2.3 2.5"/>${SHOULDERS}`;
const roleWith = (bust: string, m: Mark, s = 0.95): string => bust + m(19, 7, s);

const MEDAL = '<circle cx="12" cy="9.5" r="7.5"/><path d="M8 15.9 6.8 22l5.2-2.6 5.2 2.6L16 15.9"/>';
const medal = (m: Mark, s = 1): string => MEDAL + fine(m(12, 9.5, s));
/** Hospital capability = the "H" tile (never a cross) + the mark of the department. */
const HOSPITAL_TILE =
  '<rect x="2.5" y="2.5" width="19" height="19" rx="3"/><path d="M5.5 5.5v4.5M9 5.5v4.5M5.5 7.75H9"/>';
const hospitalWith = (m: Mark, s = 1): string => HOSPITAL_TILE + fine(m(14, 14.7, s));
const GROUND = '<path d="M2 21.5h20"/>';

// ───────────────────────────── bases for incident scenes and boats ─────────────────────────────
/** Compact car low on the left (as cat_traffic_accident), leaving the top-right corner free for a mark. */
const CAR_LOW =
  '<path d="M4.5 19.5h-2v-3l1.5-1 2-3h6l2.5 3 3 1v3h-1M8.5 19.5h4"/><circle cx="6.5" cy="19.5" r="2"/><circle cx="14.5" cy="19.5" r="2"/>';
/** Side-view hull of the boats (nose to the right), sitting on the waterline. */
const HULL = 'M2 13.5h20l-3 4.5H5z';
/** Head in profile, facing right: the skull stays free for an inner mark around (11.5, 10.5). */
const HEAD =
  '<path d="M7.5 21.5v-4.2C5.6 16 4.5 13.6 4.5 11c0-4.2 3.4-7.5 7.7-7.5 3.9 0 6.9 2.7 7.1 6.4l1.7 3.4-1.7.7v2.3a1.8 1.8 0 0 1-1.8 1.8H15.5v3.4"/>';
/** School building (clock + flag) on the left, leaving the right side free for a mark. */
const SCHOOL =
  '<path d="M2 21.5h14.5"/><path d="M3 21.5V12l5.5-5 5.5 5v9.5"/><path d="M8.5 7V2.5h3.5l-1 1.2 1 1.3H8.5"/><circle cx="8.5" cy="12.8" r="1.6"/><path d="M7 21.5V18h3v3.5"/>';
/** Industrial plant: a low block with two stacks on the left half. */
const PLANT = `${GROUND}<path d="M2.5 21.5V13h11v8.5"/><path d="M4.5 13V5.5H7V13M9.5 13V8H12v5"/>`;

/** Inner SVG markup for a 24×24 viewBox. Rendered inside <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">. */
export const PICTOGRAMS: Record<PictogramName, string> = {
  // ───────────────────────────── vehicles (side view, nose to the right) ─────────────────────────────
  veh_engine: `<path d="M4.5 17H2V7h12v10${CAB_BOX}"/><circle cx="8" cy="12" r="2.25"/><path d="M16 10V8.5h2V10"/>${WHEELS}`,
  veh_tanker: `<rect x="2" y="7.5" width="12" height="7.5" rx="3.75"/><path d="M7 7.5V6h2.5v1.5"/><path d="M2.5 17h2${CAB_DECK}"/>${WHEELS}`,
  veh_ladder: `<path d="M4.5 17H2v-4.5h13${CAB_DECK}"/><path d="M3 10.5l18-6M3 8l18-6M7.5 9V6.5M12 7.5V5M16.5 6V3.5"/>${WHEELS}`,
  veh_crane: `<path d="M4.5 17H2v-4.5h13${CAB_DECK}"/><rect x="4" y="9" width="5" height="3.5" rx="0.5"/><path d="M8 9.5 20.5 3v2.5a1.3 1.3 0 1 1-1.3 1.3"/>${WHEELS}`,
  veh_pickup: `<path d="M4.5 17H2v-5h8V8h5.5l3 4H22v5h-2.5M8.5 17h7"/><path d="M10 12h8.5M13 8v4"/>${WHEELS}`,
  veh_van: `<path d="M4.5 17H2V6.5h13l4.5 5 2.5 1V17h-2.5M8.5 17h7"/><path d="M13 6.5v5h6.5"/><path d="M9 12.5h1.5"/>${WHEELS}`,
  veh_car: `<path d="M4.5 17H2v-3.5l2.5-1.5 3-4h7l3.5 4 4 1.5V17h-2.5M8.5 17h7"/><path d="M4.5 12H18M11 8v4"/><path d="M9.5 8V6.5h3V8"/>${WHEELS}`,
  veh_motorcycle:
    '<circle cx="5.5" cy="16.5" r="3"/><circle cx="18.5" cy="16.5" r="3"/><path d="M18.5 16.5 16 8h-3"/><path d="M5.5 16.5 8.5 11"/><path d="M8.5 11h8.5l-1.5 3.5h-5z" fill="currentColor"/>',
  veh_ambulance: `<path d="M4.5 17H2V7h13l4.5 4.5 2.5 1V17h-2.5M8.5 17h7"/><path d="M4 12h2l1.5-2.5 2 5L11 12h2.5"/><path d="M7 7V5.5h3V7"/>${WHEELS}`,
  veh_truck: `<path d="M4.5 17H2V5h12v12${CAB_BOX}"/><path d="M6 8.5v5M10 8.5v5"/>${WHEELS}`,
  veh_command: `<path d="M4.5 17H2V9h17l3 3.5V17h-2.5M8.5 17h7"/><path d="M15 9v3.5h7"/><path d="M6 9V4.5M3.8 2.5a3 3 0 0 0 0 4M8.2 2.5a3 3 0 0 1 0 4"/>${WHEELS}`,
  veh_boat: `<path d="M2 12.5h20l-3 5H5z"/><path d="M8 12.5v-4h7l2 4"/><path d="M11 8.5v-3"/><path d="${WAVE_21}"/>`,
  veh_helicopter:
    '<path d="M9 9h7a5 5 0 0 1 5 5 2 2 0 0 1-2 2h-6a4 4 0 0 1-4-4z"/><path d="M9 10.5H3.5v-3"/><path d="M5 6h16M13 9V6"/><path d="M11 19.5h9M13 16v3.5M17 16v3.5"/><path d="M16 9v3.5h4.8"/>',
  veh_plane:
    '<path d="M3 11.5h13.5c3 0 5.5 1 5.5 2.5s-2.5 2.5-5.5 2.5H8c-3 0-5-2-5-5z"/><path d="M3 11.5v-5h1.5l3.5 5"/><path d="M10 14.5l-2.5 6H10l5-6"/><path d="M17.5 11.7v1.8h4"/>',
  veh_team:
    '<circle cx="7.5" cy="5" r="2"/><circle cx="16.5" cy="5" r="2"/><path d="M7.5 8.5v6L5 21M7.5 14.5 10 21M4.5 11h6M16.5 8.5v6L14 21M16.5 14.5 19 21M13.5 11h6"/>',
  veh_snowmobile:
    '<rect x="2" y="15" width="10.5" height="4.5" rx="2.25"/><path d="M13.5 20H20c1.2 0 2-.8 2-2"/><path d="M17.5 20 16 15.5"/><path d="M3.5 15v-2.5h7L12 10h3.5l5.5 4.5-4.5 1.5h-4"/><path d="M15 10l-1.5-3.5"/>',
  veh_tow: `<path d="M4.5 17H2v-3.5h13${CAB_DECK}"/><path d="M12.5 13.5 4 5.5v3a1.3 1.3 0 1 0 1.3 1.3"/><path d="M8 13.5V9.3"/>${WHEELS}`,
  veh_utility: `<path d="M4.5 17H2V8h12v9${CAB_BOX}"/><path d="M5 14.5 8.5 10.5M9 14.5l3.5-4"/><path d="M16 10V8.5h2V10"/>${WHEELS}`,

  // Newer generic classes.
  veh_foam: `<rect x="2" y="7.5" width="12" height="7.5" rx="3.75"/><path d="M5.5 7.5V5.5L10 4"/>${fine('<circle cx="6.6" cy="11.6" r="1.9"/><circle cx="10.4" cy="10.6" r="1.2"/>')}${TANKER_CHASSIS}`,
  veh_hazmat: inTruck(mark.diamond, 1.15),
  veh_bus: `<path d="M4.5 17H2V7a1.5 1.5 0 0 1 1.5-1.5H19l3 5.5v6h-2.5M8.5 17h7"/><path d="M2 11h20M6 5.5V11M10 5.5V11M14 5.5V11M18 5.5V11"/><path d="M9 5.5V4h4v1.5"/>${WHEELS}`,
  veh_tent: inTruck(mark.tent, 1.1),
  veh_suv: `${SUV}<path d="M2 12h16M8 7.5V12M13 7.5V12"/>`,
  veh_armored: `<path d="M4.5 17H2v-6l2-4.5h10.5l3 4.5 4.5 1.5V17h-2.5M8.5 17h7"/><path d="M13.5 9h1.5l1.4 2h-2.9zM5 10.5h2.5M9 10.5h2.5"/><path d="M7 6.5V5h4v1.5"/>${WHEELS}`,
  veh_plough: `<path d="M3.5 17h-2V8.5h10V17M7.5 17h5M11.5 10.5h4l3 3V17h-2"/><circle cx="5.5" cy="17" r="2"/><circle cx="14.5" cy="17" r="2"/><path d="M18.5 16.5h2M20.5 11.5c1.8 2.2 2.2 5 1.4 8"/><path d="M3 8.5c1.5-2.8 5.5-2.8 7 0"/>`,
  veh_quad:
    '<circle cx="6" cy="17" r="2.75"/><circle cx="18" cy="17" r="2.75"/><path d="M2.3 13.5a4 4 0 0 1 7.4 0M14.3 13.5a4 4 0 0 1 7.4 0"/><path d="M9.5 15h5"/><path d="M6.5 10h4.5l1.5-1.5h2.5l1.5 2.5"/><path d="M15.5 9.5 14.3 6h-2"/>',

  // ───────────────────────────── vehicle types: class silhouette + role mark ─────────────────────────────
  veh_fire_4x4: `${PICKUP}<circle cx="5.8" cy="9.6" r="2.4"/><circle cx="5.8" cy="9.6" r="0.6" fill="currentColor" stroke="none"/><path d="M12 8V6.5h2.5V8"/>`,
  veh_fire_abp: `<rect x="2" y="7.5" width="12" height="7.5" rx="3.75"/><path d="M7 7.5V6h2.5v1.5"/>${fine(mark.drop(8, 11.3, 0.72))}${TANKER_CHASSIS}`,
  veh_fire_air: inTruck(mark.cylinders, 1.1),
  veh_fire_saf: inVan(mark.saf, 1),
  veh_fire_divers: VAN + fine(mark.mask(7.2, 11.6, 0.9)),
  veh_fire_usar: inTruck(mark.rubble, 1.1),
  veh_fire_heli: heliWith(mark.flame),
  veh_fire_fireboat: `<path d="${HULL}"/><path d="M6.5 13.5V10h7l1.5 3.5"/><path d="M10 10V8.5"/><path d="M10 8.5C9.5 5.5 7 3.5 3.5 3.5M10 8.5c.8-3 3.5-5 7.5-5"/><path d="${WAVE_21}"/>`,
  veh_ems_msb: ambulanceTier([11.5]),
  veh_ems_msi: ambulanceTier([10.4, 12.6]),
  veh_ems_msa: ambulanceTier([9.4, 11.5, 13.6]),
  veh_ems_automedica: CAR + mark.heart(19.5, 5.6, 0.95),
  veh_ems_pediatric: AMBULANCE + fine(mark.teddy(8, 11.2, 1)),
  veh_ems_heli: heliWith(mark.heart, 0.95),
  veh_ems_jetski: `<path d="M8.5 17h10l3.5-3.5-4-1h-2l-2-2.5H11l-1.5 2.5H9z"/><circle cx="13" cy="4.3" r="1.6"/><path d="M12.5 6.5 12 10h-.5M12.5 7.5l3.5 2 1-1.5"/><path d="M16.5 12.5l.5-3"/><path d="M2 16h5v1.8H2z"/><path d="M7 16.9h1.5"/><path d="${WAVE_21}"/>`,
  veh_ems_water_ambulance: `<path d="${HULL}"/><path d="M4.5 13.5v-7h10l3.5 7"/>${fine(mark.pulse(9.5, 10.2, 0.9))}<path d="${WAVE_21}"/>`,
  veh_pol_traffic: CAR + mark.cone(19.5, 5.3, 0.8),
  veh_pol_van: inVan(mark.shield),
  veh_pol_k9: inVan(mark.paw),
  veh_pol_forensic: inVan(mark.magnifier),
  veh_pol_eod: inTruck(mark.bomb, 1.1),
  veh_pol_heli: heliWith(mark.shield),
  veh_pol_patrol_boat: `<path d="${HULL}"/><path d="M4.5 13.5V9h8.5l3.5 4.5"/><path d="M7 9V7.5h3V9"/>${fine(mark.shield(9.3, 11.5, 0.62))}<path d="${WAVE_21}"/>`,
  veh_aib_pickup: `${PICKUP}<rect x="2.5" y="8.3" width="6.5" height="3.7" rx="1.2"/>${mark.pine(5.7, 4.6, 0.62)}`,
  veh_aib_tanker: `<rect x="2" y="7" width="12" height="8" rx="1.5"/><path d="M7 7V5.5h2.5V7"/>${fine(mark.pine(8, 11, 0.78))}${TANKER_CHASSIS}`,
  veh_aib_command: COMMAND + fine(mark.pine(11.8, 12.6, 0.7)),
  veh_aib_heli: heliWith(mark.bucket, 0.95),
  veh_aib_plane:
    '<path d="M3 9.5h13.5c3 0 5.5 1 5.5 2.5s-2.5 2.5-5.5 2.5H8c-3 0-5-2-5-5z"/><path d="M3 9.5v-5h1.5l3.5 5"/><path d="M10 12.5l-2.5 5H10l5-5"/><path d="M17.5 9.7v1.8h4"/><circle cx="12.5" cy="17.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="15.5" cy="17" r="0.8" fill="currentColor" stroke="none"/><circle cx="18.5" cy="17.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="14" cy="20.3" r="0.8" fill="currentColor" stroke="none"/><circle cx="17" cy="20.3" r="0.8" fill="currentColor" stroke="none"/>',
  veh_alp_team:
    '<circle cx="5.5" cy="7" r="2"/><path d="M5.5 10.5v5L3.5 21.5M5.5 15.5l2 6M2.5 13h6M9.5 12v9.5"/><path d="M11 21.5 16 9l2.5 4.5 1.3-1.7 2.7 9.7"/><path d="M14.2 13.5l1.8 1.3 1.6-1.3"/>',
  veh_alp_4x4: `${SUV}<path d="M9.5 7.5V12H18M13.5 7.5V12"/>${fine(mark.peak(5.7, 11.2, 0.75))}`,
  veh_alp_k9: `${SUV}<path d="M9.5 7.5V12H18M13.5 7.5V12"/>${mark.paw(5.7, 11.2, 0.75)}`,
  veh_alp_heli: heliWith(mark.peak, 0.8),

  // ───────────────────────────── non-player support units (UNG) ─────────────────────────────
  ung_heavy_tow: `<path d="M3 17H2v-5h13${CAB_DECK.replace('M8.5 17h7', 'M11.8 17h3.7')}"/><path d="M12.5 12 3.5 3.5v4a1.4 1.4 0 1 0 1.4 1.4"/><path d="M9 12V8.7M12.5 12V8l-3.4.8"/><circle cx="5" cy="17" r="2"/><circle cx="9.8" cy="17" r="2"/><circle cx="17.5" cy="17" r="2"/>`,
  ung_crane: `<path d="M4.5 17H2v-4.5h13${CAB_DECK}"/><rect x="3.5" y="9" width="5" height="3.5" rx="0.5"/><path d="M7 9 19.5 2.5V6"/><rect x="17.2" y="6" width="4.6" height="3" rx="0.5"/>${WHEELS}`,
  ung_gas: inUtility(mark.flame),
  ung_power: inUtility(mark.bolt),
  ung_water: inUtility(mark.drop),
  ung_road: inUtility(mark.cone),
  ung_road_repair: inUtility(mark.road),
  ung_salt: inUtility(mark.salt),
  ung_municipal: inUtility(mark.townhall),
  ung_pc: inUtility(mark.shelter),

  // ───────────────────────────── service families ─────────────────────────────
  family_fire:
    '<path d="M12 2c.5 4 5.5 6.5 5.5 12.5a5.5 5.5 0 0 1-11 0c0-2.5 1-4 2.5-5.5 0 2 .5 3 1.5 3.5C10 8.5 9.5 5 12 2z"/>',
  family_ems:
    '<path d="M12 20.5 4.2 12.6a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1a4.8 4.8 0 0 1 6.8 6.8z"/><path d="M4 12.5h4.5l1.5-3 3 6 1.5-3H17"/>',
  family_police: '<path d="M12 2.5 4 5.5v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10v-6z"/>',
  family_wildfire:
    '<path d="M9 2.5 5.5 8h2l-4 6h11l-4-6h2z"/><path d="M9 14v6.5"/><path d="M18.5 11.5c.4 2.2 3 3.6 3 6.2a3 3 0 0 1-6 0c0-1.2.5-2.1 1.2-2.9.2.9.6 1.4 1.2 1.6-.3-1.6-.5-3.2.6-4.9z"/>',
  family_alpine: '<path d="M2.5 20 10 5l4.5 8 2-2.5 5 9.5z"/><path d="M7.5 10l2.5 1.8 2.8-1.8"/>',
  family_ung:
    '<path d="M21 6.5a5.5 5.5 0 0 1-7.6 5.9L6 19.8a2 2 0 0 1-2.8-2.8l7.4-7.4A5.5 5.5 0 0 1 17.5 3L14 6.5l.5 3 3 .5z"/>',

  // ───────────────────────────── facilities ─────────────────────────────
  facility_fire: `${HOUSE}<path d="M12 9c.5 2.5 3 3.8 3 6.5a3 3 0 0 1-6 0c0-1.3.6-2.2 1.3-3 .2 1 .6 1.5 1.2 1.7-.3-1.8-.7-3.5.5-5.2z"/>`,
  facility_ems: `${HOUSE}<path d="M6.5 14.5H9l1.5-3 3 6 1.5-3h2.5"/>`,
  facility_police: `${HOUSE}<path d="M12 9.5 8 11v3c0 2.5 1.7 4.2 4 5 2.3-.8 4-2.5 4-5v-3z"/>`,
  facility_wildfire: `${HOUSE}<path d="M12 8.5 9 12.5h1.5l-2.5 4h8l-2.5-4H15z"/><path d="M12 16.5V19"/>`,
  facility_alpine: `${HOUSE}<path d="M7 18.5l3.5-6.5 2 3.5 1.5-2 3 5z"/>`,
  facility_coordination: `${HOUSE}<circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/><path d="M9.2 12.2a4 4 0 0 0 0 5.6M14.8 12.2a4 4 0 0 1 0 5.6"/>`,
  facility_nautical_base: `<path d="M2 16.5V10L7.5 5.5 13 10v6.5"/>${mark.anchor(7.5, 12, 0.8)}<path d="M2 16.5h11"/><path d="M14.5 14h7.5l-1.5 2.5h-4.5z"/><path d="M17.5 14v-3.5"/><path d="${WAVE_21}"/>`,
  facility_fire_detachment: houseWithBay(mark.flame),
  facility_fire_command: headquarters(mark.flame),
  facility_fire_special_hub: specialBase(mark.flame, BADGE_STAR),
  facility_ems_station: houseWithBay(mark.pulse),
  facility_ems_advanced_station: headquarters(mark.pulse),
  facility_ems_heli_base: specialBase(mark.pulse, BADGE_HELIPAD),
  facility_police_station: houseWithBay(mark.shield),
  facility_police_hq: headquarters(mark.shield),
  facility_police_special_unit: specialBase(mark.shield, BADGE_STAR),
  facility_wildfire_base: houseWithBay(mark.pine),
  facility_wildfire_operations_center: headquarters(mark.pine),
  facility_wildfire_air_base: specialBase(mark.pine, BADGE_PLANE),
  facility_alpine_rescue_center: houseWithBay(mark.peak),
  facility_alpine_heli_base: specialBase(mark.peak, BADGE_HELIPAD),
  hospital:
    '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 6.5v6M15 6.5v6M9 9.5h6"/><path d="M10 21v-4h4v4"/>',
  helipad: '<circle cx="12" cy="12" r="9.5"/><path d="M9 8v8M15 8v8M9 12h6"/>',
  site_candidate:
    '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M8 16.5V11.5l4-3.5 4 3.5v5z"/>',

  // ───────────────────────────── incident categories ─────────────────────────────
  cat_fire_structure:
    '<path d="M12.5 21H3V10.5L8.5 6l4 3.3"/><path d="M6.5 21v-5h3.5v5"/><path d="M17.5 7c.5 3 4 5 4 9a4 4 0 0 1-8 0c0-1.8.8-3 1.8-4 .1 1.3.6 2.2 1.4 2.6-.4-2.6-.9-5 .8-7.6z"/>',
  cat_fire_vehicle:
    '<path d="M5 19.5H3v-3l2-1 2.5-3h7l3 3 3.5 1v3h-2M9 19.5h6"/><circle cx="7" cy="19.5" r="2"/><circle cx="17" cy="19.5" r="2"/><path d="M12 2c.4 2.2 3 3.4 3 5.8a3 3 0 0 1-6 0c0-1.2.5-2 1.2-2.8.2.9.6 1.4 1.2 1.6-.3-1.6-.5-3 .6-4.6z"/>',
  cat_fire_minor:
    '<path d="M6 13h12l-1.5 8.5h-9z"/><path d="M4.5 13h15"/><path d="M12 2c.4 2.2 3 3.4 3 5.8a3 3 0 0 1-6 0c0-1.2.5-2 1.2-2.8.2.9.6 1.4 1.2 1.6-.3-1.6-.5-3 .6-4.6z"/>',
  cat_technical:
    '<path d="M4 17v-1a8 8 0 0 1 16 0v1"/><path d="M10 8.3V5.5h4v2.8"/><path d="M2.5 17h19v2.5h-19z"/><path d="M10 8.5V12M14 8.5V12"/>',
  cat_traffic_accident:
    '<path d="M4.5 19.5h-2v-3l1.5-1 2-3h6l2.5 3 3 1v3h-1M8.5 19.5h4"/><circle cx="6.5" cy="19.5" r="2"/><circle cx="14.5" cy="19.5" r="2"/><path d="M17.9 12.5 18.5 9M19.4 13.4l2.3-1.9M20 15.5h2"/>',
  cat_flood: `<path d="M5 13.5V9l7-5.5L19 9v4.5"/><path d="M10 13.5V10h4v3.5"/><path d="${WAVE_17}"/><path d="${WAVE_21}"/>`,
  cat_hazmat:
    '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/><path d="M12 7.5c1.5 2 3 3.5 3 5.5a3 3 0 0 1-6 0c0-2 1.5-3.5 3-5.5z"/>',
  cat_gas_leak:
    '<path d="M6 21.5V11.5a4.5 4.5 0 0 1 9 0v10z"/><path d="M10.5 7V4M8.5 4h4"/><path d="M6 15h9"/><path d="M17 5.5c1.5-1 2.5 1 4 0M17.5 9c1.3-.8 2.2.8 3.5 0"/>',
  cat_water_rescue: `<circle cx="12" cy="9" r="2.25"/><path d="M6.5 5.5l3 6M17.5 5.5l-3 6"/><path d="${WAVE_17}"/><path d="${WAVE_21}"/>`,
  cat_medical: '<circle cx="12" cy="12" r="9.5"/><path d="M5.5 12h3l2-4 3.5 8 2-4h2.5"/>',
  cat_cardiac:
    '<path d="M12 20.5 4.2 12.6a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1a4.8 4.8 0 0 1 6.8 6.8z"/><path d="M13 8.5 10 13h4l-3 4.5"/>',
  cat_trauma:
    '<path d="M9.76 18.76 18.76 9.76a3.2 3.2 0 0 0-4.52-4.52L5.24 14.24a3.2 3.2 0 0 0 4.52 4.52z"/><path d="M7.97 11.51l4.52 4.52M11.51 7.97l4.52 4.52"/><circle cx="12" cy="12" r="0.7" fill="currentColor" stroke="none"/>',
  cat_mass_casualty:
    '<circle cx="12" cy="8" r="3"/><path d="M7.5 20v-2a4.5 4.5 0 0 1 9 0v2"/><circle cx="4.5" cy="10.5" r="1.75"/><circle cx="19.5" cy="10.5" r="1.75"/><path d="M2 19.5v-1a3.5 3.5 0 0 1 3-3.4M22 19.5v-1a3.5 3.5 0 0 0-3-3.4"/>',
  cat_public_order:
    '<path d="M3 10.5v3a1 1 0 0 0 1 1h3l8 4.5V5L7 9.5H4a1 1 0 0 0-1 1z"/><path d="M7.5 14.5l1 5.5H11l-1-4"/><path d="M18 9.5a4 4 0 0 1 0 5"/><path d="M20 7.5a7 7 0 0 1 0 9"/>',
  cat_crime:
    '<path d="M2.5 9c3-1.5 6.5-1.5 9.5 0 3-1.5 6.5-1.5 9.5 0 0 4-2 7-5 7-2.5 0-3.5-2-4.5-2s-2 2-4.5 2c-3 0-5-3-5-7z"/><ellipse cx="7.75" cy="12" rx="1.75" ry="1.15"/><ellipse cx="16.25" cy="12" rx="1.75" ry="1.15"/>',
  cat_missing_person:
    '<circle cx="9" cy="8" r="3.5"/><path d="M3 20.5V20a6 6 0 0 1 12 0v.5"/><path d="M16.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.1 1-1.1 1.8"/><circle cx="19" cy="16.5" r="0.85" fill="currentColor" stroke="none"/>',
  cat_suspicious_package:
    '<rect x="3.5" y="7.5" width="17" height="13.5" rx="1.5"/><path d="M3.5 7.5 6 3h12l2.5 4.5"/><path d="M12 11v4.5"/><circle cx="12" cy="18.2" r="0.9" fill="currentColor" stroke="none"/>',
  cat_wildfire:
    '<path d="M9 2.5c.5 4 5.5 6.5 5.5 12.5a5.5 5.5 0 0 1-11 0c0-2.5 1-4 2.5-5.5 0 2 .5 3 1.5 3.5C7 9 6.5 5.5 9 2.5z"/><path d="M18.5 8.5l-2.5 4h1.5L15 17h7l-2.5-4.5H21z"/><path d="M18.5 17v3.5"/>',
  cat_mountain:
    '<path d="M2 20 9 8l4 6.5 2.5-3.5 6.5 9z"/><path d="M19 3v4.5"/><circle cx="19" cy="10.2" r="0.9" fill="currentColor" stroke="none"/>',
  cat_avalanche:
    '<path d="M2 9v12h18z"/><circle cx="9.5" cy="9.5" r="2.75"/><circle cx="16.5" cy="15" r="1.75"/><circle cx="15" cy="6" r="1.25"/>',
  cat_weather:
    '<path d="M7 16a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 8.5a3.75 3.75 0 0 1-.5 7.47"/><path d="M13 11.5l-3 5h4L11.5 21"/>',
  cat_generic:
    '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>',

  // ───────────────────────────── incident templates ─────────────────────────────
  inc_alp_injured_hiker:
    '<path d="M2.5 14.5 9 3.5l3.5 6 2.5-3 6.5 8z"/><path d="M2.5 19.5H7l1.5-2.5 3 5 1.5-2.5h8"/>',
  inc_alp_missing_hiker:
    '<path d="M2 20.5 8 9l4 7 2-2.5 4 7z"/><path d="M16.5 5.5a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.1 1-1.1 1.8"/><circle cx="19" cy="12.5" r="0.85" fill="currentColor" stroke="none"/>',
  inc_alp_wall_recovery:
    '<path d="M2 21.5h4.5l-1-5 1.5-4.5-1.5-4 1-5.5"/><path d="M6.3 4H14v4.5"/><circle cx="14" cy="10.3" r="1.8"/><path d="M14 12.2v4.5M11.3 14.2l2.7-1 2.7 1M14 16.7l-2 3.8M14 16.7l2 3.8"/>',
  inc_alp_stranded_group: `<path d="M2.5 10.5 9 3l3.5 4.5L15 5l6.5 5.5"/>${mark.people(12, 16.2, 2.1)}`,
  inc_alp_twisted_ankle:
    '<path d="M8 3.5h5v6.5l5.5 2.3a3 3 0 0 1 2 2.8v3.4H8z"/><path d="M8 16h12.5"/><path d="M13 6h-2M13 8.5h-2"/><path d="M5.5 9.5 3.5 8M5 12.5H2.5M5.5 15.5l-2 1.5"/>',
  inc_alp_mtb_crash:
    '<circle cx="5.5" cy="14.07" r="3.2"/><circle cx="16.63" cy="18.57" r="3.2"/><path d="M5.5 14.07 10.99 9.82l5.57 2.25.07 6.5M10.99 9.82l.07 6.5 5.5-4.25M5.5 14.07l5.56 2.25M10.99 9.82l.1-1.58M9.98 7.79l2.41.97M16.56 12.07l.28-2.05 1.86.75"/><path d="M19.5 6.5l.5-3M21 8.5l1.5-1.5"/>',
  inc_alp_lost_forager: `<path d="M2.5 12a6 6 0 0 1 12 0z"/><path d="M6.5 12v6.5a2 2 0 0 0 4 0V12"/>${mark.question(18.5, 9, 1.15)}`,
  inc_alp_ski_slope_injury: `<path d="M5 20.5 17.3 4.3a1.3 1.3 0 0 1 2.2 1.3"/><path d="M19 20.5 6.7 4.3a1.3 1.3 0 0 0-2.2 1.3"/>${mark.heart(12, 20, 0.85)}`,
  inc_alp_canyon_rescue: `<path d="M2.5 2.5l2 4.5-1.5 4 2 4.5-1 6"/><path d="M21.5 2.5l-2 3.5 1.5 4.5-2 4 1 7"/><path d="M6.5 17.5c1-.7 1.8-.7 2.75 0s1.75.7 2.75 0 1.75-.7 2.75 0 1.75.7 2.75 0"/><path d="M7.5 21c.9-.6 1.6-.6 2.3 0s1.6.6 2.3 0 1.6-.6 2.3 0 1.6.6 2.3 0"/><circle cx="12" cy="13" r="2"/><path d="M12 2.5V11"/>`,
  inc_alp_paraglider: `<path d="M3 9C4.5 3.5 19.5 3.5 21 9c-2-1.3-5-2-9-2s-7 .7-9 2z"/><path d="M3.5 9 12 16.5M20.5 9 12 16.5M8.5 7.3 12 16.5M15.5 7.3 12 16.5"/><circle cx="12" cy="18" r="1.3"/><path d="M12 19.3v2.2"/>`,
  inc_alp_cave_rescue: `<path d="M2 21.5 5 11.5l3.5-3 2-4 4 1.5 3 4.5 1.5 4 3 7.5"/><path d="M6.5 21.5c0-3 .8-6.5 2.8-8.3s3.9-1.8 5.4 0 2.8 5.3 2.8 8.3"/><path d="M9.6 14.2l.9 2.3.9-2.3M12.8 13.3l.9 2.3.9-2.3"/>${GROUND}`,
  inc_alp_chairlift_evacuation:
    '<path d="M2 5 22 2"/><path d="M10 3.8V9H6.5v5.5H14V12"/><circle cx="9.6" cy="11.4" r="1.3"/><path d="M10 17v4.5M8 19.5l2 2 2-2"/>',
  inc_alp_ice_climber:
    '<path d="M2 3h20"/><path d="M4.5 3l1.2 5 1.2-5M9 3l1 3.5 1-3.5M13.5 3l1.2 6 1.2-6M18.5 3l1 3.8 1-3.8"/><path d="M5.5 20.5 14.5 11.5"/><path d="M11.5 8.8 14.5 11.5c1.5 1.3 2.8 2.9 3.6 4.7"/><path d="M5.5 20.5 4.5 21.5"/>',
  inc_alp_snow_emergency: `<path d="M3.5 21.5V14l6-4.5 6 4.5v7.5"/><path d="M2 13.5 9.5 7.5 17 13.5"/><path d="M7.5 21.5v-3.5h4v3.5"/><path d="M2 21.5h15.5"/>${mark.snowflake(19, 5, 1)}`,
  inc_med_minor_illness:
    '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none"/><path d="M12 16.5V9"/><path d="M17 6h2M17 9.5h2M17 13h2"/>',
  inc_med_severe_illness:
    '<path d="M6 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><circle cx="8" cy="18" r="1.5" fill="currentColor" stroke="none"/><path d="M8 16.5V6.5"/><path d="M17.5 4.5v9"/><circle cx="17.5" cy="17.5" r="1" fill="currentColor" stroke="none"/>',
  inc_med_unconscious:
    '<path d="M2 20h20"/><circle cx="5" cy="15.5" r="2.25"/><path d="M8.5 17h12.5M12 17l3-3h3.5"/><path d="M12 4.5h4.5L12 10h4.5M18.5 2.5h3l-3 3.5h3"/>',
  inc_med_fall:
    '<path d="M2 21.5h20"/><circle cx="7.5" cy="6" r="2.1"/><path d="M9 8.5l4.5 5.5M7.5 12.5l3.5-1.5 4-2M13.5 14l-4 3.5M13.5 14l4.5 2"/><path d="M17.5 3.5V7M20.5 5.5V9"/>',
  inc_med_pediatric: mark.teddy(12, 12.8, 2.5),
  inc_med_allergic_reaction: `${HEAD}<circle cx="15.5" cy="12" r=".85" fill="currentColor" stroke="none"/><circle cx="13" cy="14" r=".85" fill="currentColor" stroke="none"/><circle cx="16" cy="15.3" r=".85" fill="currentColor" stroke="none"/><circle cx="12.5" cy="17.3" r=".85" fill="currentColor" stroke="none"/>`,
  inc_med_diabetic: `<rect x="4" y="8.5" width="11" height="13" rx="2.5"/><rect x="6.5" y="11" width="6" height="4" rx=".8"/><path d="M8 18.5h3"/><path d="M8 8.5V5h3v3.5"/>${mark.drop(18.5, 6.5, 1.05)}`,
  inc_med_seizure: `${HEAD}${mark.bolt(11.8, 10.8, 1.15)}`,
  inc_med_abdominal_pain:
    '<path d="M8.5 2.5V6C6 7 3.5 9.5 3.5 13.5c0 4.5 3.5 7.5 8 7.5 5 0 9-3 9-7 0-2-1.3-3-2.8-2.5-1.7.6-3 1.5-4.7 1-1.8-.6-2.5-2.5-2.5-5V2.5"/><path d="M8 13.5l1.5 1.5-1 1.5 1.5 1.5"/>',
  inc_med_elderly_assist: `<circle cx="9.5" cy="4.5" r="2"/><path d="M10.5 7.5 8.5 13.5l-1.5 8M8.5 13.5l3 3 .5 5M10 9l3.5 2.5"/><path d="M13.5 11.5v10M13.5 11.5a1.3 1.3 0 0 0-2.6 0"/>${GROUND}<path d="M18.5 16V8M16 10.5l2.5-2.5 2.5 2.5"/>`,
  inc_med_intoxication:
    '<path d="M4 21.5h5.5V11.5C9.5 10 8 9 8 7.5V3.5H5.5v4C5.5 9 4 10 4 11.5z"/><path d="M4 14.5h5.5"/><path d="M13 9h8l-4 5v6M14.5 21h5"/><path d="M14.5 11h5"/>',
  inc_med_workplace_injury: `<path d="M3 17.5a7 7 0 0 1 14 0"/><path d="M1.5 17.5h17"/><path d="M8.5 10.8v3.2M11.5 10.8v3.2"/>${mark.bandage(18.8, 5.8, 1.15)}`,
  inc_med_sports_injury: `<circle cx="9.5" cy="14" r="7"/><path d="M9.5 11.2l2.3 1.7-.9 2.7H8.1l-.9-2.7z"/><path d="M9.5 11.2V7M11.8 12.9l4-1.3M10.9 15.6l2.5 3.4M8.1 15.6l-2.5 3.4M7.2 12.9l-4-1.3"/>${mark.bandage(18.5, 5.5, 1.1)}`,
  inc_med_heat_stroke: `<path d="M2 20h20"/><circle cx="5" cy="15.5" r="2.25"/><path d="M8.5 17h12.5M12 17l3-3h3.5"/>${mark.sun(17.5, 6.5, 1.25)}`,
  inc_med_respiratory_crisis:
    '<path d="M12 3v8.5M12 11.5l-2.5 2M12 11.5l2.5 2"/><path d="M9.5 8.5C6.5 8.5 3 13.5 3 18c0 1.8 1.2 3 3 3 2.2 0 3.5-1.3 3.5-3.5z"/><path d="M14.5 8.5c3 0 6.5 5 6.5 9.5 0 1.8-1.2 3-3 3-2.2 0-3.5-1.3-3.5-3.5z"/>',
  inc_med_obstetric:
    '<circle cx="10.5" cy="4" r="2.3"/><path d="M9.3 7.3 8 13.5v8M12 7.3c.3 1.7 1.2 2.6 2.5 3.1 2.3.9 3.5 2.6 3.5 4.6 0 2.2-1.8 3.7-4.6 3.7h-1v2.8"/><path d="M10 9.3l3 3.5"/>',
  inc_med_psychiatric: `${HEAD}<path d="M9.5 11.5c0-2 1.5-3 3-3s2.5 1 2.5 2.3-1 2-2 2-1.6-.6-1.6-1.3.6-1 1.1-1"/>`,
  inc_med_school_emergency: `${SCHOOL}${mark.heart(19, 15, 1.2)}`,
  inc_med_stroke_alert: `${mark.brain(10, 13, 2)}${mark.stopwatch(18.5, 5, 1)}`,
  inc_med_food_poisoning_event: `<path d="M3 3v5a1.8 1.8 0 0 0 3.6 0V3M4.8 3v18.5"/><path d="M11 21.5V3c1.5 0 2.5 3 2.5 7H11"/>${mark.people(17.8, 15, 1.15)}`,
  inc_med_nursing_home_event:
    '<path d="M2 21.5h13.5"/><path d="M3 21.5V9.5L8 5l5 4.5v12"/><path d="M5.8 12.5h.4M9.8 12.5h.4M5.8 16h.4M9.8 16h.4"/><path d="M18 21.5V9.5a2.2 2.2 0 0 1 4.4 0"/>',
  inc_med_swimmer_distress: `<path d="${WAVE_17}"/><path d="${WAVE_21}"/><circle cx="8" cy="12" r="2"/><path d="M10 11.5l2.5-5"/>${mark.lifebuoy(18, 7.5, 1.15)}`,
  inc_med_lake_rescue: `${mark.pine(4.5, 6.5, 1)}${mark.pine(9, 7.5, 0.75)}<path d="M2 12.5h20"/><path d="${WAVE_21}"/><circle cx="15" cy="15" r="2"/><path d="M17 14.5l2.5-5"/>`,
  inc_fire_apartment_block: `${GROUND}<path d="M3.5 21.5V3h9.5v18.5"/><path d="M6.2 7h1.2M9.2 7h1.2M6.2 11h1.2M9.2 11h1.2M6.2 15h1.2M9.2 15h1.2"/>${mark.flame(18, 14, 1.4)}`,
  inc_fire_warehouse: `${GROUND}<path d="M2 21.5V11l5.5-3.5V11L13 7.5v14"/><path d="M5 21.5v-5.5h5v5.5"/>${mark.flame(18, 14.5, 1.4)}`,
  inc_fire_chimney: `<path d="M3.5 21.5v-8L10 8l6.5 5.5v8"/>${GROUND}<path d="M12.5 9.7V6.5h2.5v5.3"/>${mark.flame(13.75, 3, 0.75)}<circle cx="18.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/><circle cx="20" cy="10" r=".8" fill="currentColor" stroke="none"/>`,
  inc_fire_kitchen: `<path d="M3 14h12l-1 3.3a1.5 1.5 0 0 1-1.4 1.2H5.4A1.5 1.5 0 0 1 4 17.3z"/><path d="M15 14.8h6.5"/>${mark.flame(9, 7.5, 1.35)}<path d="M2 21.5h14"/>`,
  inc_fire_balcony: `${GROUND}<path d="M2.5 21.5V2.5H9v19"/><path d="M4.8 6.5h2M4.8 10.5h2M4.8 18h2"/><path d="M9 16.5h9M9 12.5h9v4M12 12.5v4M15 12.5v4"/>${mark.flame(13.5, 6.8, 1.3)}`,
  inc_fire_electrical_panel: `<rect x="3" y="3.5" width="11" height="18" rx="1.5"/>${fine(mark.bolt(8.5, 12.5, 1.2))}${mark.flame(18.5, 14.5, 1.3)}`,
  inc_fire_shop: `<path d="M3.5 5h11l1 4.5h-13z"/><path d="M2.5 9.5v.8a2.2 2.2 0 0 0 4.4 0 2.2 2.2 0 0 0 4.4 0 2.2 2.2 0 0 0 4.4 0v-.8"/><path d="M3.5 12.5v9h11v-9M3.5 15.5h11M3.5 18.5h11"/>${mark.flame(19.5, 13.5, 1.2)}`,
  inc_fire_basement: `<path d="M2 9.5h20"/><path d="M5 9.5V4h9v5.5"/><path d="M5 9.5v12h14v-12"/>${mark.flame(12, 16, 1.2)}`,
  inc_fire_farm_building: `${GROUND}<path d="M2.5 21.5V12l2-4.5 4.5-3 4.5 3 2 4.5v9.5"/><path d="M6.5 21.5v-5h5v5M6.5 16.5l5 5M11.5 16.5l-5 5"/><path d="M8 10h2v2H8z"/>${mark.flame(19.3, 14.5, 1.2)}`,
  inc_fire_bus: `<path d="M4.5 20H2v-7.5a1.5 1.5 0 0 1 1.5-1.5H19l3 4.5V20h-2.5M8.5 20h7"/><path d="M2 14.5h20M6.5 11v3.5M11 11v3.5M15.5 11v3.5"/><circle cx="6.5" cy="20" r="2"/><circle cx="17.5" cy="20" r="2"/>${mark.flame(12, 5.3, 1.2)}`,
  inc_fire_parking_garage: `${CAR_LOW}<rect x="2.5" y="2.5" width="7.5" height="7.5" rx="1.5"/><path d="M5.3 8.2V4.4h1.6a1.2 1.2 0 0 1 0 2.4H5.3"/>${mark.flame(17.5, 7, 1.25)}`,
  inc_fire_industrial_plant: `${PLANT}<path d="M6 3.5a2.2 2.2 0 0 1 3.8-1 2.6 2.6 0 0 1 4.7 1.2 2 2 0 0 1 .5 3.8H8"/>${mark.flame(18.5, 15, 1.3)}`,
  inc_fire_vessel_blaze: `<path d="${HULL}"/><path d="${WAVE_21}"/>${mark.flame(12, 7.5, 1.4)}`,
  inc_tech_elevator:
    '<rect x="4.5" y="2.5" width="15" height="19" rx="1.5"/><path d="M12 2.5v19"/><path d="M8.2 14.5v-5M6.4 11.3l1.8-1.8L10 11.3M15.8 9.5v5M14 12.7l1.8 1.8 1.8-1.8"/>',
  inc_tech_fallen_tree:
    '<path d="M2 20.5h20"/><path d="M4 20.5V18h3.5v2.5"/><path d="M19.5 4 8.5 9.5l6 6.5z"/><path d="M11.5 12.8 7.5 17.5"/><path d="M18.5 12.5a9 9 0 0 1-2.5 5.5"/>',
  inc_tech_unsafe_roof:
    '<path d="M4.5 21.5V11.5M19.5 21.5V14M4.5 21.5h15"/><path d="M2.5 12.5 12 4.5l4 3.4M19 10.5l2.5 2"/><path d="M16.2 10.5l2 1-1 2-2-1zM14 15.5l1.6.8-.8 1.6-1.6-.8z"/>',
  inc_tech_animal_rescue:
    '<path d="M5 13V3.5l4 3.5h6l4-3.5V13a7 7 0 0 1-14 0z"/><circle cx="9.3" cy="11.5" r="0.9" fill="currentColor" stroke="none"/><circle cx="14.7" cy="11.5" r="0.9" fill="currentColor" stroke="none"/><path d="M11 15l1 1 1-1M2 13.5l3.5.8M2.5 17l3-.7M22 13.5l-3.5.8M21.5 17l-3-.7"/>',
  inc_tech_person_locked_in: `<path d="M2 21.5h14"/><path d="M4 21.5V3h10v18.5"/><path d="M11.5 12v1.5"/>${mark.padlock(18.5, 12, 1.25)}`,
  inc_tech_water_leak: `<path d="M2 4.5h8.5l1 1.5-1 1.5-1 1.5H2M22 4.5h-8.5l1 1.5-.5 1.5 1 1.5H22"/>${mark.drop(12, 14, 0.9)}${mark.drop(7.5, 13, 0.6)}${mark.drop(16.5, 13, 0.6)}<path d="M2 20c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0"/>`,
  inc_tech_insect_nest:
    '<path d="M3 3h18"/><path d="M12 3v2.5"/><path d="M12 5.5c-3.5 0-5.5 3.5-5.5 7s2.5 7.5 5.5 7.5 5.5-4 5.5-7.5-2-7-5.5-7z"/><path d="M7 9.5h10M6.5 13h11M7.3 16.5h9.4"/>',
  inc_tech_gas_smell:
    '<path d="M2.5 21.5V12l6-5 6 5v9.5z"/><path d="M6.5 21.5v-5h4v5"/><path d="M16.5 10.5c1.5-1 2.5 1 4 0M16.5 14c1.5-1 2.5 1 4 0M16.5 17.5c1.5-1 2.5 1 4 0"/>',
  inc_tech_dangling_object:
    '<path d="M2.5 2.5v19"/><path d="M2.5 5.5H14M4.5 5.5v2"/><path d="M13 5.5V9"/><path d="M13 9 6.07 13l2.5 4.33 6.93-4z"/><path d="M17 17.5h4.5M16 20.5h3.5M18 14.5h2"/>',
  inc_tech_industrial_machine: `${mark.gear(9.5, 14, 1.8)}${mark.jaws(18.5, 6.5, 1.1)}`,
  inc_tech_person_on_ledge:
    '<path d="M2 21.5h9.5V11H2"/><path d="M4.5 14h1.5M7.5 14H9M4.5 17.5h1.5M7.5 17.5H9"/><circle cx="12" cy="3.8" r="1.7"/><path d="M12 5.8v3M12 8.8 11 11M12 8.8l1 2.2M9.5 6.5l2.5 1 2.5-1"/><path d="M2 11h13"/>',
  inc_tech_confined_space:
    '<path d="M12 3 4 21.5M12 3l8 18.5"/><ellipse cx="12" cy="19.5" rx="4.5" ry="1.6"/><path d="M12 3v15"/><circle cx="7.3" cy="11" r="1.3"/>',
  inc_tech_vessel_adrift: `<path d="M2 14h14l-2.5 4H4.5z"/><path d="M5 14v-3.5h5l1.5 3.5"/><path d="${WAVE_21}"/><path d="M13 7c1.3-1 2.5-1 3.8 0s2.5 1 3.7 0M18.8 4.8l1.7 2.2-2 1.7"/>`,
  inc_road_accident_trapped: `<path d="M4.5 19.5h-2v-3l1.5-1 2-3h6l2.5 3 3 1v3h-1M8.5 19.5h4"/><circle cx="6.5" cy="19.5" r="2"/><circle cx="14.5" cy="19.5" r="2"/><path d="M4 15.5h10.5"/>${mark.jaws(18.5, 6.5, 1.1)}`,
  inc_road_pedestrian_struck: `${CAR_LOW}<circle cx="19.5" cy="4" r="1.7"/><path d="M19 6.2 17.8 10.5l-2.3 2.5M17.8 10.5l2.7 2.5M16.5 7.5l2.3.8 2.7-1"/>`,
  inc_road_motorcycle:
    '<circle cx="4.8" cy="17.5" r="2.4"/><circle cx="15.2" cy="17.5" r="2.4"/><path d="M15.2 17.5 13.2 10.7h-2.4M4.8 17.5l2.4-4.4"/><path d="M7.2 13.1H14l-1.2 2.8h-4z" fill="currentColor"/><path d="M17.9 9.5 18.5 6M19.4 10.4l2.3-1.9M20 12.5h2"/>',
  inc_road_vehicle_off_road:
    '<path d="M2 11.5h3l16 9.24"/><path d="M6.68 10.05 4.86 9l1.58-2.73 1.89-.12 3.39-1.68 5.46 3.15.69 4.04 2.21 2.49-1.58 2.73-.91-.53M10.32 12.15l3.64 2.1"/><circle cx="8.5" cy="11.1" r="2.1"/><circle cx="15.77" cy="15.3" r="2.1"/>',
  inc_road_fuel_spill: `<path d="M8.5 3 3.5 21.5M15.5 3l5 18.5M12 4v2M12 9v2.5"/>${mark.drop(12, 16.5, 1)}<path d="M7.5 20.5h9"/>`,
  inc_road_truck_overturned:
    '<path d="M2 12h13v8.5H2z"/><path d="M15.5 14.5H21v4l-2 2h-3.5z"/><path d="M13 14.5h2.5"/><circle cx="4.8" cy="12" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="18.5" cy="14.5" r="1.8"/><path d="M1.5 20.5h21"/><path d="M11 8.5 10 5.5M14 9l1.5-2.5M7 9 5 7"/>',
  inc_multi_road_accident:
    '<path d="M3 19.5H1.5V16l2-3.5H8l2.5 3.5h1v3.5h-.9M6.2 19.5h1.2"/><circle cx="4.6" cy="19.5" r="1.6"/><circle cx="9" cy="19.5" r="1.6"/><path d="M21 19.5h1.5V16l-2-3.5H16L13.5 16h-1v3.5h.9M17.8 19.5h-1.2"/><circle cx="19.4" cy="19.5" r="1.6"/><circle cx="15" cy="19.5" r="1.6"/><path d="M12 9.5V5M8.8 10.5 7.2 7M15.2 10.5 16.8 7"/>',
  inc_multi_fire_with_casualties: `${mark.flame(8, 11.5, 2.1)}<circle cx="18.5" cy="10" r="2.3"/><path d="M14.5 20.5V19a4 4 0 0 1 8 0v1.5"/>`,
  inc_multi_hazmat_spill: `<rect x="7" y="2.5" width="10" height="13.5" rx="1.5"/><path d="M7 6.5h10M7 12h10"/>${mark.drop(12, 9.3, 0.5)}<ellipse cx="12" cy="19.3" rx="9.5" ry="2.2"/>`,
  inc_multi_building_collapse: `${mark.rubble(11, 12.6, 2.5)}<path d="M5 14.5h2.5v3H5zM17 18l1.5-2 2 1"/>`,
  inc_multi_capsized_boat: `<path d="M2.5 13h14l-2.5-5.5H5z"/><path d="M13.5 7.5l.5-2.5"/><path d="M2 16c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0"/><path d="M2 21c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0"/><circle cx="19.5" cy="11.5" r="1.8"/><path d="M16.5 8l1.8 2.2M22.5 8l-1.8 2.2"/>`,
  inc_multi_person_overboard: `<path d="M2 11h11l-2 4H4z"/><path d="M4.5 11V8h4.5l1.5 3"/><path d="${WAVE_17}"/><path d="${WAVE_21}"/><circle cx="17.5" cy="11.5" r="1.8"/><path d="M19.3 11l1.7-4.5"/>`,
  inc_multi_power_blackout: `${GROUND}<path d="M3 21.5V12h5v9.5M8 21.5V8h5v13.5"/>${mark.bolt(17.5, 8, 1.3)}<path d="M13.5 3.5l8 9"/>`,
  inc_multi_school_evacuation: `${SCHOOL}${mark.flame(19.3, 14.5, 1.3)}`,
  inc_multi_heatwave_surge: `${mark.sun(7.5, 7.5, 1.35)}${mark.people(15, 17, 1.65)}`,
  inc_multi_boat_incident: `<path d="M2 12.5h8.5l-1.8 3.5H3.8z"/><path d="M4 12.5V10h3.5l1.2 2.5"/><path d="M22 12.5h-8.5l1.8 3.5h4.9z"/><path d="M20 12.5V10h-3.5l-1.2 2.5"/><path d="M12 7V3.5M9.5 7.5 8.3 5M14.5 7.5l1.2-2.5"/><path d="${WAVE_21}"/>`,
  inc_multi_flood_emergency: `<path d="M5.5 14.5 8 10.5h7l3 4"/><path d="M10.5 10.5v4"/><path d="${WAVE_17}"/><path d="${WAVE_21}"/><path d="M5 3.5 4 6M10 3 9 5.5M15 3.5 14 6M20 3l-1 2.5"/>`,
  inc_multi_winter_storm: `<path d="M6 16l2.5-4.5h7l3 4.5"/><path d="M11.5 11.5V16"/><path d="M2 18c1.5-2.5 4-3 6.5-2.5 2 .4 3.5.4 5.5-.2 3-.9 6-.3 8 2.7"/>${mark.snowflake(5, 5.5, 0.85)}${mark.snowflake(18.5, 5, 0.85)}`,
  inc_multi_landslide: `<path d="M2 3.5c2.5 2 4 5 5.5 9s4 7.5 7 9"/><path d="M8.5 7.5l2-1 1.5 1-.5 2-2 .5-1.5-1zM11 12.5l2.3-.8 1.2 1.5-.8 1.8-2 0-.9-1.3z"/><path d="M15 21.5v-4.5l3.3-3 3.2 3v4.5"/>${GROUND}`,
  inc_multi_train_derailment:
    '<path d="M3.51 17.09 1.7 9.81a1.5 1.5 0 0 1 1.09-1.82l10.67-2.66 4.97 3.4 1.09 4.36zM4.36 10.17l2.91-.72M9.22 8.96l2.91-.72M14.55 7.63l2.23 1.51"/><circle cx="7.27" cy="17.69" r="1.6"/><circle cx="16.49" cy="15.4" r="1.6"/><path d="M2 21.5h20M4.5 21.5v-1.5M9 21.5v-1.5M13.5 21.5v-1.5M18 21.5v-1.5"/>',
  inc_multi_tunnel_fire: `<path d="M2 21.5V11a10 10 0 0 1 20 0v10.5"/><path d="M6 21.5V13a6 6 0 0 1 12 0v8.5"/>${mark.flame(12, 17.3, 1)}`,
  inc_multi_stadium_crush: `${mark.people(12, 12, 1.9)}<path d="M2 12h3M3.5 10.5 5 12l-1.5 1.5M22 12h-3M20.5 10.5 19 12l1.5 1.5"/><path d="M4 20h16"/>`,
  inc_multi_industrial_explosion: `${PLANT}${mark.blast(18, 11.5, 1.2)}`,
  inc_multi_hospital_evacuation: `${GROUND}<path d="M3 21.5V5.5h10v16"/><path d="M6 9v5M10 9v5M6 11.5h4"/><path d="M6.5 21.5v-3h3v3"/>${mark.flame(18.5, 14.5, 1.3)}`,
  inc_multi_aircraft_accident: `<path d="M14.71 14.71 9.63 12.24l-6.95 1.45-1.45-1.45 5.22-3.18-2.47-3.05-2.61.29-1.01-1.01 3.19-1.74 1.74-3.19 1.01 1.01-.29 2.61 3.05 2.47 3.18-5.22 1.45 1.45-1.45 6.95z"/>${GROUND}${mark.flame(18.5, 17.3, 1)}`,
  inc_multi_bridge_collapse: `<path d="M2 7.5h8l-1 2.5H2M22 7.5h-8l1 2.5h7"/><path d="M5 10v11.5M19 10v11.5"/><path d="M9.6 11.2l1.8-.9 4.8 7.7-1.8.9z"/><path d="M6.5 20c1-.7 1.7-.7 2.7 0s1.7.7 2.7 0 1.7-.7 2.7 0 1.7.7 2.7 0"/>`,
  inc_multi_earthquake:
    '<path d="M4.5 14V8l6.5-5 6.5 5v6"/><path d="M11 3l-1 3 2 2-1.5 3 1 3"/><path d="M2 19h4l1.5-3 2 6 2-8.5 2 7 1.5-4 1 2.5H22"/>',
  inc_pol_brawl:
    '<circle cx="6" cy="6.5" r="2"/><circle cx="18" cy="6.5" r="2"/><path d="M6 10v5.5l-2 6M6 15.5l2.5 6M6 11.5l5-1.5M18 10v5.5l2 6M18 15.5l-2.5 6M18 11.5l-5-1.5"/><path d="M12 2.5v3M9.8 3.5l.8 2M14.2 3.5l-.8 2"/>',
  inc_pol_alarm_activation:
    '<path d="M7.5 17v-5a4.5 4.5 0 0 1 9 0v5z"/><path d="M5.5 17h13v3.5h-13z"/><path d="M12 11v3"/><path d="M12 4V2M5.3 6.8 3.9 5.4M18.7 6.8l1.4-1.4M3.5 12.5H2M22 12.5h-1.5"/>',
  inc_pol_accident_survey:
    '<rect x="5" y="4" width="14" height="17.5" rx="1.5"/><path d="M9 4V2.8h6V4"/><path d="M8 9h8M8 12.5h8M8 16.5h3.5"/><path d="M13.3 16.8l1.4 1.4 2.4-2.8"/>',
  inc_pol_public_event: `<path d="M2.5 3.5c3 2.5 6.3 2.5 9.5 0 3.2 2.5 6.5 2.5 9.5 0"/><path d="M6 5.2l.9 2.5L8.3 5.4M15.7 5.4l1.4 2.3.9-2.5"/>${mark.people(12, 15.5, 2.1)}`,
  inc_pol_traffic_disruption:
    '<rect x="8" y="2.5" width="8" height="16" rx="2"/><circle cx="12" cy="6.3" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="10.5" r="1.4"/><circle cx="12" cy="14.7" r="1.4"/><path d="M12 18.5v3M8.5 21.5h7M8 7H5.5M8 12H5.5M16 7h2.5M16 12h2.5"/>',
  inc_pol_noise_complaint: `<path d="M8 17V6.5l9-2.5v11"/><path d="M8 9.5l9-2.5"/><ellipse cx="6" cy="17" rx="2" ry="1.6"/><ellipse cx="15" cy="15" rx="2" ry="1.6"/>${mark.moon(19.5, 19, 0.85)}`,
  inc_pol_parking_obstruction: `${CAR_LOW}<circle cx="18.5" cy="6.5" r="3.5"/><path d="M16 4l5 5"/>`,
  inc_pol_shoplifting: `<path d="M2 4h2.5l2.5 11h11l2-8H5.5"/><circle cx="8.5" cy="19" r="1.6"/><circle cx="16.5" cy="19" r="1.6"/>${fine(mark.bandit(12.8, 11, 1))}`,
  inc_pol_vandalism: `<path d="M3.5 21.5V11a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v10.5z"/><path d="M6 9V6.5h2V9"/><circle cx="11.5" cy="4.5" r=".7" fill="currentColor" stroke="none"/><circle cx="13.5" cy="6.3" r=".7" fill="currentColor" stroke="none"/><circle cx="13.3" cy="3" r=".7" fill="currentColor" stroke="none"/><path d="M14 18.5c1-3 2-5 3-5s0 5 1.5 5 1.5-6 3-6"/>`,
  inc_pol_stray_animal_road: `<path d="M8.5 3 3.5 21.5M15.5 3l5 18.5M12 4v2M12 8.5v2"/>${mark.paw(12, 16.5, 1.2)}`,
  inc_pol_domestic_disturbance: `<path d="M2.5 21.5V11L12 3.5l9.5 7.5v10.5z"/>${mark.shout(12, 15, 1.35)}`,
  inc_pol_dui_checkpoint: `${CAR_LOW}<circle cx="18.5" cy="6" r="3.3"/><circle cx="18.5" cy="6" r="1.3"/><path d="M18.5 9.3v4"/>`,
  inc_pol_road_rage: `${CAR_LOW}${mark.shout(17.5, 6.5, 1.2)}`,
  inc_pol_burglary_report: `<path d="M2.5 21.5V11L12 3.5l9.5 7.5v10.5z"/>${mark.bandit(12, 14.5, 1.3)}`,
  inc_pol_atm_attack: `<rect x="3" y="3" width="11" height="18.5" rx="1.5"/><rect x="5.5" y="5.5" width="6" height="4.5" rx=".5"/><path d="M6 13.5h5M6.5 17h4"/>${mark.blast(18.5, 8.5, 1.1)}`,
  inc_pol_vehicle_pursuit:
    '<path d="M8 19.5H6v-3l1.5-1 2-3h6l2.5 3 3 1v3h-1M12 19.5h4"/><circle cx="10" cy="19.5" r="2"/><circle cx="18" cy="19.5" r="2"/><path d="M1.5 13.5h3M2.5 16.5h2M3 10.5h4"/>',
  inc_pol_missing_child: `<circle cx="8" cy="7.5" r="2.5"/><path d="M8 10v5.5M8 15.5 6 21M8 15.5l2 5.5M5 12.5l3-1.5 3 1.5"/>${mark.question(17, 9, 1.2)}`,
  inc_pol_demonstration: `<rect x="3" y="2.5" width="8" height="5" rx=".8"/><path d="M7 7.5v5"/><rect x="13" y="3.5" width="8" height="5" rx=".8"/><path d="M17 8.5v4.5"/>${mark.people(12, 17.5, 1.85)}`,
  inc_pol_armed_robbery: `<path d="M8 8 6.5 4.5h6L11 8"/><path d="M8 8c-3 1.5-5 5-5 8.5 0 3 2 5 6.5 5S16 19.5 16 16.5c0-3.5-2-7-5-8.5z"/>${mark.crosshair(18.5, 6.5, 1.25)}`,
  inc_pol_drug_operation:
    '<path d="M2.5 21.5V11L12 3.5l9.5 7.5v10.5z"/><path d="M9.14 16.31l4.17-4.17a1.8 1.8 0 0 1 2.55 2.55l-4.17 4.17a1.8 1.8 0 0 1-2.55-2.55z"/><path d="M11.23 14.23 9.14 16.31a1.8 1.8 0 0 0 2.55 2.55l2.08-2.09z" fill="currentColor"/>',
  inc_pol_hostage_situation: `<circle cx="8.5" cy="8" r="3.5"/><path d="M2.5 20.5V20a6 6 0 0 1 12 0v.5"/>${mark.padlock(18.5, 9.5, 1.25)}`,
  inc_pol_stadium_disorder: `<path d="M2 20.5h20"/><path d="M2.5 20.5V11l5.5 4v5.5M21.5 20.5V11L16 15v5.5"/><path d="M2.5 11V4.5M21.5 11V4.5M1.5 4.5h2M20.5 4.5h2"/>${mark.blast(12, 9.5, 1.05)}`,
  inc_pol_public_attack: `${mark.blast(12, 7.5, 1.45)}${mark.people(12, 18, 1.85)}`,
  inc_wf_brush: `<path d="M2 20.5h20"/><path d="M3.5 20.5a3 3 0 0 1 1-5.5 3.5 3.5 0 0 1 6.5-1 3 3 0 0 1 3 3.5 2 2 0 0 1-.5 3"/>${mark.flame(18.5, 12.5, 1.3)}`,
  inc_wf_forest_medium: mark.pine(5, 13.5, 1.3) + mark.pine(12, 13.5, 1.3) + mark.flame(19, 13.5, 1.15),
  inc_wf_forest_large:
    mark.pine(4.5, 17.5, 0.95) +
    mark.pine(12, 17.5, 0.95) +
    mark.pine(19.5, 17.5, 0.95) +
    mark.flame(12, 7, 1.5) +
    mark.flame(4.8, 8.5, 0.8) +
    mark.flame(19.2, 8.5, 0.8),
  inc_wf_interface: `<path d="M2 21.5V14l4.5-3.5L11 14v7.5z"/><path d="M5 21.5v-3.5h3v3.5"/>${mark.pine(15.5, 16, 1.25)}${mark.flame(19.3, 6.5, 1.1)}`,
  inc_wf_roadside_verge: `<path d="M2 16.5h20M2 21.5h20M4 19h2.5M10.75 19h2.5M17.5 19H20"/>${mark.flame(9, 8.5, 1.35)}${mark.flame(17, 10.5, 0.85)}<path d="M3.5 16.5l1-2.5 1 2.5M13 16.5l1-2.5 1 2.5M19.5 16.5l1-2 1 2"/>`,
  inc_wf_stubble_field: `${mark.flame(12, 7, 1.4)}${GROUND}<path d="M3.5 21.5v-2M6.5 21.5v-2M9.5 21.5v-2M12.5 21.5v-2M15.5 21.5v-2M18.5 21.5v-2M5 16.5v-1.5M8 16.5v-1.5M11 16.5v-1.5M14 16.5v-1.5M17 16.5v-1.5M20 16.5v-1.5"/>`,
  inc_wf_pruning_burn: `<path d="M3 21l10-3.5M3 17.5 13 21"/>${mark.flame(8, 10.5, 1.4)}${mark.flame(18, 15.5, 0.85)}<path d="M15 21.5h7"/>`,
  inc_wf_waste_dump: `<path d="M2 21.5l2-4 2.5-1 1.5-3 3 .5 2-2 2.5 2 2 3 1.5-.5 1.5 3 1.5 2z"/><circle cx="8.5" cy="18.5" r="1.6"/><path d="M13.5 16.5l2.5 2.5"/>${mark.flame(12, 6, 1.3)}`,
  inc_wf_reignition: `${GROUND}<path d="M4.5 21.5v-3l1-1 1 1v3M17.5 21.5v-2.5l1-1 1 1v2.5"/>${mark.flame(12, 11.5, 1.2)}<path d="M6 8a6.5 6.5 0 0 1 11.8-1.5M18 3.5v3h-3"/>`,
  inc_wf_powerline_corridor: `<path d="M3 21.5 6.5 3.5h1L11 21.5M3 7h8M4 11.5h6M5 14.5l4 4M9 14.5l-4 4"/><path d="M11 7c4 1.5 7.5 1.5 11 0"/>${mark.flame(17.5, 16, 1.25)}`,
  inc_wf_night_front: `${mark.moon(5.5, 5.5, 1.05)}${mark.pine(5, 16.5, 1.3)}${mark.pine(11.5, 16.5, 1.3)}${mark.flame(18.5, 15.5, 1.3)}`,
  inc_wf_steep_slope: `<path d="M2 21.5 13 3.5l9 18"/>${mark.pine(8.5, 15.5, 0.9)}${mark.flame(14.5, 13.5, 1.15)}${mark.pine(18.5, 17.3, 0.8)}`,
  inc_wf_campsite_threat: `${GROUND}<path d="M3 21.5 9 9.5l6 12M9 21.5l-2-4h4z"/>${mark.flame(18.5, 12.5, 1.35)}`,
  inc_wf_multiple_ignitions: `<path d="M3 21.5 9.5 15"/><circle cx="10.5" cy="14" r="1.4" fill="currentColor" stroke="none"/>${mark.flame(6.5, 6, 0.9)}${mark.flame(16, 5.5, 1.2)}${mark.flame(18.5, 16.5, 0.9)}`,

  // ───────────────────────────── capabilities ─────────────────────────────
  cap_fire_suppression:
    '<path d="M2.5 6.5h4L9 5v6L6.5 9.5h-4z"/><path d="M11 7.5c3 0 5.5 1 7 3M11 10c1.5 0 2.5.5 3.5 1.5"/><path d="M17 11.5c.4 2.2 3.2 3.6 3.2 6.2a3.2 3.2 0 0 1-6.4 0c0-1.2.5-2.1 1.3-2.9.2.9.6 1.4 1.2 1.6-.3-1.6-.5-3.2.7-4.9z"/>',
  cap_water_supply:
    '<path d="M12 2.5c3 4 6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0c0-4.5 3.5-7.5 6.5-11.5z"/><path d="M8.5 14.5A3.5 3.5 0 0 0 12 18"/>',
  cap_height_access: '<path d="M8 2.5v19M16 2.5v19"/><path d="M8 6.5h8M8 10.5h8M8 14.5h8M8 18.5h8"/>',
  cap_extrication:
    '<path d="M12 11.5C8.5 10.5 7 7 8.5 2.5l3.5 5 3.5-5c1.5 4.5 0 8-3.5 9z"/><path d="M11 13 6.5 21.5M13 13l4.5 8.5"/><circle cx="12" cy="12.5" r="0.9" fill="currentColor" stroke="none"/>',
  cap_technical_rescue:
    '<path d="M8 8V6.5a4 4 0 0 1 8 0v4a4 4 0 0 1-8 0"/><path d="M8 8l2.5 2.5"/><path d="M12 11.5v4"/><ellipse cx="12" cy="18.5" rx="4.5" ry="3"/>',
  cap_heavy_rescue:
    '<path d="M12 2.5V7a2 2 0 1 1-2 2"/><path d="M12 11l-6 5M12 11l6 5"/><rect x="4" y="16" width="16" height="5.5" rx="1"/>',
  cap_hazmat: '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/><path d="M7.25 7.25l9.5 9.5M16.75 7.25l-9.5 9.5"/>',
  cap_water_rescue:
    '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4"/><path d="M5.3 5.3l3.9 3.9M14.8 14.8l3.9 3.9M18.7 5.3l-3.9 3.9M9.2 14.8l-3.9 3.9"/>',
  cap_medical_basic:
    '<rect x="3" y="7.5" width="18" height="13" rx="2"/><path d="M9 7.5v-2A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2"/><path d="M12 17.5l-3-3a2 2 0 0 1 3-2.6 2 2 0 0 1 3 2.6z"/>',
  cap_medical_advanced:
    '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 21h7M12 17v4"/><path d="M5.5 10.5h3l1.5-3 3 6 1.5-3h4"/>',
  cap_patient_transport:
    '<path d="M2.5 12.5h19"/><circle cx="5.5" cy="9" r="1.75"/><path d="M9.5 9.5h10"/><path d="M6.5 12.5l9.5 6M17.5 12.5l-9.5 6"/><circle cx="7.5" cy="20" r="1.5"/><circle cx="16.5" cy="20" r="1.5"/>',
  cap_mass_casualty:
    '<path d="M12 3 2.5 20.5h19z"/><path d="M12 18.5l-3-3a2 2 0 0 1 3-2.6 2 2 0 0 1 3 2.6z"/>',
  cap_scene_security:
    '<path d="M12 2.5 4 5.5v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10v-6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  cap_traffic_control:
    '<path d="M10.5 3.5h3l4.5 17H6z"/><path d="M3 20.5h18"/><path d="M8.8 10h6.4M7.5 15h9"/>',
  cap_investigation:
    '<circle cx="10.5" cy="10.5" r="7"/><path d="M15.5 15.5l6 6"/><path d="M7 10.5A3.5 3.5 0 0 1 10.5 7"/>',
  cap_k9_search:
    '<path d="M12 12c-2.5 0-5 3-5 5.5 0 1.8 1.3 3 3 3 .8 0 1.3-.4 2-.4s1.2.4 2 .4c1.7 0 3-1.2 3-3 0-2.5-2.5-5.5-5-5.5z"/><ellipse cx="4.5" cy="11.5" rx="1.25" ry="1.75" fill="currentColor"/><ellipse cx="9" cy="6.5" rx="1.25" ry="1.75" fill="currentColor"/><ellipse cx="15" cy="6.5" rx="1.25" ry="1.75" fill="currentColor"/><ellipse cx="19.5" cy="11.5" rx="1.25" ry="1.75" fill="currentColor"/>',
  cap_eod:
    '<circle cx="10" cy="14.5" r="6.5"/><path d="M14.1 7.2l3.2 3.2"/><path d="M15.7 8.8c1-1.5 1.5-3.5 3.8-4"/><circle cx="20.3" cy="4.2" r="1.1" fill="currentColor" stroke="none"/>',
  cap_wildland_fire:
    '<circle cx="9" cy="9" r="5.5"/><path d="M9 14.5V21"/><path d="M2.5 21h19"/><path d="M17.5 11c.4 2.2 3 3.6 3 6.2a3 3 0 0 1-6 0c0-1.2.5-2.1 1.2-2.9.2.9.6 1.4 1.2 1.6-.3-1.6-.5-3.2.6-4.9z"/>',
  cap_offroad_access:
    '<circle cx="12" cy="10.5" r="8"/><circle cx="12" cy="10.5" r="2.75"/><path d="M16.8 12.5L19.4 13.6M14 15.3L15.1 17.9M10 15.3L8.9 17.9M7.2 12.5L4.6 13.6M7.2 8.5L4.6 7.4M10 5.7L8.9 3.1M14 5.7L15.1 3.1M16.8 8.5L19.4 7.4"/><path d="M2 20.5 5.5 19l3 2 3.5-2.5 3.5 2.5 3-2 3.5 1.5"/>',
  cap_mountain_rescue: '<path d="M2.5 20.5 10 8.5l4 6.5 2.5-3 5 8.5z"/><path d="M10 8.5v-6l5 1.75-5 1.75"/>',
  cap_air_support:
    '<path d="M2.5 5.5h19M12 5.5v3"/><ellipse cx="12" cy="13" rx="5" ry="4.5"/><path d="M7.2 12h9.6"/><path d="M9 17l-.5 3.5M15 17l.5 3.5M6.5 20.5h4M13.5 20.5h4"/>',
  cap_command:
    '<path d="M12 8.5 7.5 21.5M12 8.5l4.5 13M9.2 16.5h5.6"/><circle cx="12" cy="7" r="1.25" fill="currentColor" stroke="none"/><path d="M8 3.5a5 5 0 0 0 0 7M16 3.5a5 5 0 0 1 0 7"/><path d="M5 2a8.5 8.5 0 0 0 0 10M19 2a8.5 8.5 0 0 1 0 10"/>',
  cap_logistics:
    '<rect x="4.5" y="3.5" width="15" height="13" rx="1"/><path d="M9.5 3.5v13M14.5 3.5v13"/><path d="M2.5 19h19M5 19v2.5M12 19v2.5M19 19v2.5"/>',
  // ───────────────────────────── items (consumables) ─────────────────────────────
  item_foam: `<path d="M6 21.5V8l3-3h6.5A2.5 2.5 0 0 1 18 7.5v14z"/><path d="M10 5V3h4v2"/>${mark.bubbles(11.7, 14, 1.15)}`,
  item_absorbent:
    '<path d="M7 7c-2.3 2.8-3.5 5.7-3.5 8.5 0 4 2.5 6 8.5 6s8.5-2 8.5-6c0-2.8-1.2-5.7-3.5-8.5z"/><path d="M7 7 6 3.5h12L17 7"/><circle cx="9" cy="14" r="0.9" fill="currentColor" stroke="none"/><circle cx="12.5" cy="17" r="0.9" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="0.9" fill="currentColor" stroke="none"/>',
  item_extrication_kit: `<rect x="3" y="8.5" width="18" height="12.5" rx="1.5"/><path d="M9 8.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2.5"/>${mark.jaws(12, 14.8, 1.05)}`,
  item_medical_pack: `<path d="M6 21.5V9.5a6 6 0 0 1 12 0v12z"/><path d="M10 3.7a2 2 0 0 1 4 0M6 16h12"/>${mark.heart(12, 10.8, 0.9)}`,
  item_trauma_pack: `<rect x="2.5" y="8" width="19" height="12.5" rx="2.5"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>${mark.bandage(12, 14.2, 1.25)}`,
  item_oxygen:
    '<path d="M8 21.5V10a4 4 0 0 1 8 0v11.5z"/><path d="M12 6V3.5M9.5 3.5h5"/><circle cx="12" cy="13" r="1.9"/><path d="M8 17.8h8"/>',
  item_retardant: `<rect x="5" y="3.5" width="14" height="18" rx="2"/><path d="M5 7h14M5 18h14"/>${mark.pine(12, 12.5, 1.05)}`,
  item_generic: '<path d="M3 8l9-4.5L21 8v8.5L12 21l-9-4.5z"/><path d="M3 8l9 4.5L21 8M12 12.5V21"/>',

  // ───────────────────────────── facility upgrades ─────────────────────────────
  upgrade_garage:
    '<path d="M3 21.5V9l9-5.5L21 9v12.5"/><path d="M6.5 21.5V12.5h11v9M6.5 15.5h11M6.5 18.5h11"/>',
  upgrade_quarters:
    '<path d="M2.5 19.5V5.5M2.5 16h19v3.5M21.5 16v-2.5A2.5 2.5 0 0 0 19 11h-8.5v5"/><circle cx="6.5" cy="12.3" r="1.8"/>',
  upgrade_storage:
    '<path d="M3.5 2.5v19M20.5 2.5v19M3.5 9.5h17M3.5 16h17"/><rect x="6" y="5" width="4.5" height="4.5"/><rect x="12.5" y="11.5" width="5" height="4.5"/><rect x="6.5" y="18" width="4" height="3.5"/><path d="M3.5 21.5h17"/>',
  upgrade_workshop:
    '<path d="M4.5 20.5 14 11"/><path d="M12.5 6.5 17.5 11.5 20.5 8.5 15.5 3.5z"/><path d="M19.5 20.5 11.5 12.5"/><path d="M11.5 12.5 8 11.5 4 6l1.5-1.5L11 8.5z"/>',
  upgrade_training_room:
    '<path d="M2 9.5 12 5l10 4.5L12 14z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 9.5V15"/>',
  upgrade_pier:
    '<path d="M2 9.5h20M2 12h20"/><path d="M5 12v9.5M12 12v9.5M19 12v9.5"/><path d="M14.5 9.5V8h-.8V6.5h3.6V8h-.8v1.5"/><path d="M2 17c1-.7 2-.7 3 0M5 17c1 .7 2 .7 3.5 0M12 17c1 .7 2 .7 3.5 0M19 17c1 .7 2 .7 3 0"/>',
  upgrade_generic: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 17V7.5M8 11.5l4-4 4 4"/>',

  // ───────────────────────────── roles ─────────────────────────────
  role_firefighter: roleWith(BUST_HELMET, mark.flame),
  role_driver_operator: roleWith(BUST_HELMET, mark.wheel),
  role_team_leader: roleWith(BUST_HELMET, mark.chevrons),
  role_rescuer: roleWith(BUST_PLAIN, mark.heart, 1.05),
  role_driver: roleWith(BUST_PLAIN, mark.wheel),
  role_nurse: `${BUST_PLAIN}${mark.pulse(19, 7, 0.85)}`,
  role_physician: roleWith(BUST_PLAIN, mark.stethoscope),
  role_officer: roleWith(BUST_CAP, mark.shield),
  role_specialist: roleWith(BUST_CAP, mark.magnifier),
  role_wildland_operator: roleWith(BUST_HELMET, mark.pine),
  role_alpine_rescuer: roleWith(BUST_HELMET, mark.peak, 0.85),
  role_pilot: roleWith(BUST_HEADSET, mark.planeTop, 1.05),
  role_generic: BUST_PLAIN,

  // ───────────────────────────── qualifications (medal + skill mark) ─────────────────────────────
  qualification: MEDAL + mark.star(12, 9.5, 1.1),
  qual_heavy_vehicle_license: medal(mark.truckMini),
  qual_emergency_driving: medal(mark.siren),
  qual_road_rescue: medal(mark.jaws, 0.9),
  qual_aerial_ladder_operator: medal(mark.ladder),
  qual_crane_operator: medal(mark.hook, 1.05),
  qual_saf: medal(mark.saf),
  qual_nbcr: medal(mark.diamond),
  qual_usar: medal(mark.rubble),
  qual_diver: medal(mark.mask, 0.9),
  qual_boat_operator: medal(mark.boat, 0.9),
  qual_incident_command: medal(mark.radio, 1.0),
  qual_blsd: medal(mark.heart, 1.1),
  qual_als: medal(mark.pulse, 1.0),
  qual_pediatric_care: medal(mark.teddy),
  qual_mci_management: medal(mark.people),
  qual_hems_crew: medal(mark.heli),
  qual_motorcycle_patrol: medal(mark.moto),
  qual_traffic_investigation: medal(mark.cone, 0.9),
  qual_public_order: medal(mark.megaphone),
  qual_k9_handler: medal(mark.paw),
  qual_eod_tech: medal(mark.bomb, 0.9),
  qual_forensics: medal(mark.magnifier),
  qual_tactical_ops: medal(mark.crosshair, 1.05),
  qual_wildland_firefighting: medal(mark.pine, 1.0),
  qual_wildland_command: medal(mark.pineRadio),
  qual_mountain_rescue_tech: medal(mark.peak),
  qual_avalanche_rescue: medal(mark.avalanche),
  qual_snow_vehicle: medal(mark.snowflake, 1.05),
  qual_heli_pilot: medal(mark.rotor),
  qual_airplane_pilot: medal(mark.planeTop, 1.15),
  qual_winch_operator: medal(mark.winch, 1.0),

  // ───────────────────────────── hospital capabilities ("H" tile + department mark) ─────────────────────────────
  hosp_general_emergency: hospitalWith(mark.siren),
  hosp_intensive_care: hospitalWith(mark.pulse, 0.95),
  hosp_cardiology: hospitalWith(mark.heart, 1.15),
  hosp_stroke_unit: hospitalWith(mark.brain, 1.1),
  hosp_trauma_center: hospitalWith(mark.bandage, 1.15),
  hosp_pediatrics: hospitalWith(mark.teddy),
  hosp_obstetrics: hospitalWith(mark.baby, 1.05),
  hosp_burn_unit: hospitalWith(mark.flame),
  hosp_toxicology: hospitalWith(mark.flask, 0.9),

  // ───────────────────────────── generic world glyphs ─────────────────────────────
  course:
    '<path d="M12 6.5c-2-1.5-5-2-9-2v14c4 0 7 .5 9 2 2-1.5 5-2 9-2v-14c-4 0-7 .5-9 2z"/><path d="M12 6.5v14"/>',
  closure:
    '<path d="M2.5 7.5h19v6h-19z"/><path d="M6 13.5l3.5-6M11 13.5l3.5-6M16 13.5l3.5-6"/><path d="M6 13.5v8M18 13.5v8M4 21.5h4M16 21.5h4"/>',
  coverage:
    '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.25"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><path d="M12 12l6.7-6.7"/>',
};
