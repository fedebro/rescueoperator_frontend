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
};
