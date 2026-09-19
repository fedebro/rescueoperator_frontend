/**
 * Icon name registry for the Rescue Control game icon set.
 * Pictograms: 24×24, stroke based, `currentColor`. Top-down glyphs: 32×32, nose pointing up (north).
 */
export const VEHICLE_CLASSES = [
  'engine',
  'tanker',
  'ladder',
  'crane',
  'pickup',
  'van',
  'car',
  'motorcycle',
  'ambulance',
  'truck',
  'command',
  'boat',
  'helicopter',
  'plane',
  'team',
  'snowmobile',
  'tow',
  'utility',
] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const FAMILY_ICONS = [
  'family_fire',
  'family_ems',
  'family_police',
  'family_wildfire',
  'family_alpine',
  'family_ung',
] as const;

export const FACILITY_ICONS = [
  'facility_fire',
  'facility_ems',
  'facility_police',
  'facility_wildfire',
  'facility_alpine',
  'facility_coordination',
  'hospital',
  'helipad',
  'site_candidate',
] as const;

export const CATEGORY_ICONS = [
  'cat_fire_structure',
  'cat_fire_vehicle',
  'cat_fire_minor',
  'cat_technical',
  'cat_traffic_accident',
  'cat_flood',
  'cat_hazmat',
  'cat_gas_leak',
  'cat_water_rescue',
  'cat_medical',
  'cat_cardiac',
  'cat_trauma',
  'cat_mass_casualty',
  'cat_public_order',
  'cat_crime',
  'cat_missing_person',
  'cat_suspicious_package',
  'cat_wildfire',
  'cat_mountain',
  'cat_avalanche',
  'cat_weather',
  'cat_generic',
] as const;

export const CAPABILITY_ICONS = [
  'cap_fire_suppression',
  'cap_water_supply',
  'cap_height_access',
  'cap_extrication',
  'cap_technical_rescue',
  'cap_heavy_rescue',
  'cap_hazmat',
  'cap_water_rescue',
  'cap_medical_basic',
  'cap_medical_advanced',
  'cap_patient_transport',
  'cap_mass_casualty',
  'cap_scene_security',
  'cap_traffic_control',
  'cap_investigation',
  'cap_k9_search',
  'cap_eod',
  'cap_wildland_fire',
  'cap_offroad_access',
  'cap_mountain_rescue',
  'cap_air_support',
  'cap_command',
  'cap_logistics',
] as const;

export const PICTOGRAM_NAMES = [
  ...VEHICLE_CLASSES.map((c) => `veh_${c}` as const),
  ...FAMILY_ICONS,
  ...FACILITY_ICONS,
  ...CATEGORY_ICONS,
  ...CAPABILITY_ICONS,
] as const;
export type PictogramName = (typeof PICTOGRAM_NAMES)[number];
