import type { PictogramName, VehicleClass } from './names';
import { CAPABILITY_ICONS as CAPABILITY_NAMES, FAMILY_ICONS, VEHICLE_CLASSES } from './names';

/**
 * Catalog `icon` keys (rescue-control-backend/catalog/data/*.yaml: `vehicle-fire-aps`, `facility-ems-post`,
 * `incident-med-cardiac-arrest`, `capability-hazmat`, `ung-tow`, `item-foam`…) → icon set names.
 * Every key of the catalog must resolve here through an EXPLICIT table: `catalog-map.test.ts` fails when the catalog
 * grows and this file does not. The prefix-based fallbacks only serve keys of a newer catalog than this client.
 */

/** Vehicle / UNG unit key → [pictogram, top-down map class]. */
const VEHICLES: Record<string, readonly [PictogramName, VehicleClass]> = {
  'vehicle-fire-aps': ['veh_engine', 'engine'],
  'vehicle-fire-4x4': ['veh_fire_4x4', 'pickup'],
  'vehicle-fire-abp': ['veh_fire_abp', 'tanker'],
  'vehicle-fire-as': ['veh_ladder', 'ladder'],
  'vehicle-fire-boat': ['veh_boat', 'boat'],
  'vehicle-fire-ag': ['veh_crane', 'crane'],
  'vehicle-fire-foam': ['veh_foam', 'foam'],
  'vehicle-fire-air': ['veh_fire_air', 'truck'],
  'vehicle-fire-saf': ['veh_fire_saf', 'van'],
  'vehicle-fire-ucl': ['veh_command', 'command'],
  'vehicle-fire-divers': ['veh_fire_divers', 'van'],
  'vehicle-fire-nbcr': ['veh_hazmat', 'hazmat'],
  'vehicle-fire-usar': ['veh_fire_usar', 'truck'],
  'vehicle-fire-heli': ['veh_fire_heli', 'helicopter'],
  'vehicle-fire-fireboat': ['veh_fire_fireboat', 'boat'],
  'vehicle-ems-msb': ['veh_ems_msb', 'ambulance'],
  'vehicle-ems-msi': ['veh_ems_msi', 'ambulance'],
  'vehicle-ems-automedica': ['veh_ems_automedica', 'car'],
  'vehicle-ems-msa': ['veh_ems_msa', 'ambulance'],
  'vehicle-ems-pediatric': ['veh_ems_pediatric', 'ambulance'],
  'vehicle-ems-maxi': ['veh_bus', 'bus'],
  'vehicle-ems-pma': ['veh_tent', 'tent'],
  'vehicle-ems-heli': ['veh_ems_heli', 'helicopter'],
  'vehicle-ems-jetski': ['veh_ems_jetski', 'boat'],
  'vehicle-ems-water-ambulance': ['veh_ems_water_ambulance', 'boat'],
  'vehicle-pol-patrol': ['veh_car', 'car'],
  'vehicle-pol-moto': ['veh_motorcycle', 'motorcycle'],
  'vehicle-pol-traffic': ['veh_pol_traffic', 'car'],
  'vehicle-pol-van': ['veh_pol_van', 'van'],
  'vehicle-pol-k9': ['veh_pol_k9', 'van'],
  'vehicle-pol-forensic': ['veh_pol_forensic', 'van'],
  'vehicle-pol-eod': ['veh_pol_eod', 'truck'],
  'vehicle-pol-tactical': ['veh_armored', 'armored'],
  'vehicle-pol-heli': ['veh_pol_heli', 'helicopter'],
  'vehicle-pol-patrol-boat': ['veh_pol_patrol_boat', 'boat'],
  'vehicle-aib-pickup': ['veh_aib_pickup', 'pickup'],
  'vehicle-aib-tanker': ['veh_aib_tanker', 'tanker'],
  'vehicle-aib-command': ['veh_aib_command', 'command'],
  'vehicle-aib-heli': ['veh_aib_heli', 'helicopter'],
  'vehicle-aib-plane': ['veh_aib_plane', 'plane'],
  'vehicle-alp-team': ['veh_alp_team', 'team'],
  'vehicle-alp-4x4': ['veh_alp_4x4', 'suv'],
  'vehicle-alp-snow': ['veh_snowmobile', 'snowmobile'],
  'vehicle-alp-k9': ['veh_alp_k9', 'suv'],
  'vehicle-alp-heli': ['veh_alp_heli', 'helicopter'],
  'ung-tow': ['veh_tow', 'tow'],
  'ung-heavy-tow': ['ung_heavy_tow', 'tow'],
  'ung-crane': ['ung_crane', 'crane'],
  'ung-gas': ['ung_gas', 'utility'],
  'ung-power': ['ung_power', 'utility'],
  'ung-water': ['ung_water', 'utility'],
  'ung-road': ['ung_road', 'utility'],
  'ung-road-repair': ['ung_road_repair', 'utility'],
  'ung-snow': ['veh_plough', 'plough'],
  'ung-salt': ['ung_salt', 'plough'],
  'ung-municipal': ['ung_municipal', 'utility'],
  'ung-pc': ['ung_pc', 'utility'],
};

const FACILITIES: Record<string, PictogramName> = {
  'facility-fire-local-station': 'facility_fire',
  'facility-fire-detachment': 'facility_fire_detachment',
  'facility-fire-command': 'facility_fire_command',
  'facility-fire-special-hub': 'facility_fire_special_hub',
  'facility-ems-post': 'facility_ems',
  'facility-ems-station': 'facility_ems_station',
  'facility-ems-advanced-station': 'facility_ems_advanced_station',
  'facility-ems-heli-base': 'facility_ems_heli_base',
  'facility-police-post': 'facility_police',
  'facility-police-station': 'facility_police_station',
  'facility-police-hq': 'facility_police_hq',
  'facility-police-special-unit': 'facility_police_special_unit',
  'facility-aib-outpost': 'facility_wildfire',
  'facility-aib-base': 'facility_wildfire_base',
  'facility-aib-operations-center': 'facility_wildfire_operations_center',
  'facility-aib-air-base': 'facility_wildfire_air_base',
  'facility-alpine-station': 'facility_alpine',
  'facility-alpine-rescue-center': 'facility_alpine_rescue_center',
  'facility-alpine-heli-base': 'facility_alpine_heli_base',
  'facility-coordination-center': 'facility_coordination',
  'facility-nautical-base': 'facility_nautical_base',
};

/** Incident category (catalog `category`, upper-case) → pictogram. `incident.icon` keys refine it further. */
const CATEGORY: Record<string, PictogramName> = {
  FIRE: 'cat_fire_structure',
  MEDICAL: 'cat_medical',
  ROAD: 'cat_traffic_accident',
  TECHNICAL: 'cat_technical',
  WILDFIRE: 'cat_wildfire',
  MOUNTAIN: 'cat_mountain',
  PUBLIC_ORDER: 'cat_public_order',
  SEARCH: 'cat_missing_person',
  HAZMAT: 'cat_hazmat',
  CRIME: 'cat_crime',
  WEATHER: 'cat_weather',
  WATER: 'cat_water_rescue',
  COLLAPSE: 'inc_multi_building_collapse',
};

/**
 * One glyph per incident template (grouped by service, catalog order): a `cat_*` glyph is reused only where it depicts
 * exactly that template, so every template of the catalog shows a different pictogram.
 */
const INCIDENTS: Record<string, PictogramName> = {
  'incident-alp-injured-hiker': 'inc_alp_injured_hiker',
  'incident-alp-missing-hiker': 'inc_alp_missing_hiker',
  'incident-alp-avalanche': 'cat_avalanche',
  'incident-alp-wall-recovery': 'inc_alp_wall_recovery',
  'incident-alp-stranded-group': 'inc_alp_stranded_group',
  'incident-alp-twisted-ankle': 'inc_alp_twisted_ankle',
  'incident-alp-mtb-crash': 'inc_alp_mtb_crash',
  'incident-alp-lost-forager': 'inc_alp_lost_forager',
  'incident-alp-ski-slope-injury': 'inc_alp_ski_slope_injury',
  'incident-alp-canyon-rescue': 'inc_alp_canyon_rescue',
  'incident-alp-paraglider': 'inc_alp_paraglider',
  'incident-alp-cave-rescue': 'inc_alp_cave_rescue',
  'incident-alp-chairlift-evacuation': 'inc_alp_chairlift_evacuation',
  'incident-alp-ice-climber': 'inc_alp_ice_climber',
  'incident-alp-snow-emergency': 'inc_alp_snow_emergency',
  'incident-med-minor-illness': 'inc_med_minor_illness',
  'incident-med-severe-illness': 'inc_med_severe_illness',
  'incident-med-unconscious': 'inc_med_unconscious',
  'incident-med-cardiac-arrest': 'cat_cardiac',
  'incident-med-fall': 'inc_med_fall',
  'incident-med-major-trauma': 'cat_trauma',
  'incident-med-multi-patient': 'cat_mass_casualty',
  'incident-med-pediatric': 'inc_med_pediatric',
  'incident-med-allergic-reaction': 'inc_med_allergic_reaction',
  'incident-med-diabetic': 'inc_med_diabetic',
  'incident-med-seizure': 'inc_med_seizure',
  'incident-med-abdominal-pain': 'inc_med_abdominal_pain',
  'incident-med-elderly-assist': 'inc_med_elderly_assist',
  'incident-med-intoxication': 'inc_med_intoxication',
  'incident-med-workplace-injury': 'inc_med_workplace_injury',
  'incident-med-sports-injury': 'inc_med_sports_injury',
  'incident-med-heat-stroke': 'inc_med_heat_stroke',
  'incident-med-respiratory-crisis': 'inc_med_respiratory_crisis',
  'incident-med-obstetric': 'inc_med_obstetric',
  'incident-med-psychiatric': 'inc_med_psychiatric',
  'incident-med-school-emergency': 'inc_med_school_emergency',
  'incident-med-stroke-alert': 'inc_med_stroke_alert',
  'incident-med-food-poisoning-event': 'inc_med_food_poisoning_event',
  'incident-med-nursing-home-event': 'inc_med_nursing_home_event',
  'incident-med-swimmer-distress': 'inc_med_swimmer_distress',
  'incident-med-lake-rescue': 'inc_med_lake_rescue',
  'incident-fire-trash-bin': 'cat_fire_minor',
  'incident-fire-vehicle': 'cat_fire_vehicle',
  'incident-fire-dwelling': 'cat_fire_structure',
  'incident-fire-apartment-block': 'inc_fire_apartment_block',
  'incident-fire-warehouse': 'inc_fire_warehouse',
  'incident-fire-chimney': 'inc_fire_chimney',
  'incident-fire-kitchen': 'inc_fire_kitchen',
  'incident-fire-balcony': 'inc_fire_balcony',
  'incident-fire-electrical-panel': 'inc_fire_electrical_panel',
  'incident-fire-shop': 'inc_fire_shop',
  'incident-fire-basement': 'inc_fire_basement',
  'incident-fire-farm-building': 'inc_fire_farm_building',
  'incident-fire-bus': 'inc_fire_bus',
  'incident-fire-parking-garage': 'inc_fire_parking_garage',
  'incident-fire-industrial-plant': 'inc_fire_industrial_plant',
  'incident-fire-vessel-blaze': 'inc_fire_vessel_blaze',
  'incident-tech-elevator': 'inc_tech_elevator',
  'incident-tech-fallen-tree': 'inc_tech_fallen_tree',
  'incident-tech-flooding': 'cat_flood',
  'incident-tech-unsafe-roof': 'inc_tech_unsafe_roof',
  'incident-tech-animal-rescue': 'inc_tech_animal_rescue',
  'incident-tech-person-locked-in': 'inc_tech_person_locked_in',
  'incident-tech-water-leak': 'inc_tech_water_leak',
  'incident-tech-insect-nest': 'inc_tech_insect_nest',
  'incident-tech-gas-smell': 'inc_tech_gas_smell',
  'incident-tech-dangling-object': 'inc_tech_dangling_object',
  'incident-tech-industrial-machine': 'inc_tech_industrial_machine',
  'incident-tech-person-on-ledge': 'inc_tech_person_on_ledge',
  'incident-tech-confined-space': 'inc_tech_confined_space',
  'incident-tech-vessel-adrift': 'inc_tech_vessel_adrift',
  'incident-road-pedestrian-struck': 'inc_road_pedestrian_struck',
  'incident-road-accident-minor': 'cat_traffic_accident',
  'incident-road-accident-trapped': 'inc_road_accident_trapped',
  'incident-road-motorcycle': 'inc_road_motorcycle',
  'incident-road-vehicle-off-road': 'inc_road_vehicle_off_road',
  'incident-road-fuel-spill': 'inc_road_fuel_spill',
  'incident-road-truck-overturned': 'inc_road_truck_overturned',
  'incident-multi-capsized-boat': 'inc_multi_capsized_boat',
  'incident-multi-person-overboard': 'inc_multi_person_overboard',
  'incident-multi-road-accident': 'inc_multi_road_accident',
  'incident-multi-fire-with-casualties': 'inc_multi_fire_with_casualties',
  'incident-multi-gas-leak': 'cat_gas_leak',
  'incident-multi-severe-weather': 'cat_weather',
  'incident-multi-person-in-water': 'cat_water_rescue',
  'incident-multi-hazmat-spill': 'inc_multi_hazmat_spill',
  'incident-multi-building-collapse': 'inc_multi_building_collapse',
  'incident-multi-power-blackout': 'inc_multi_power_blackout',
  'incident-multi-school-evacuation': 'inc_multi_school_evacuation',
  'incident-multi-heatwave-surge': 'inc_multi_heatwave_surge',
  'incident-multi-boat-incident': 'inc_multi_boat_incident',
  'incident-multi-flood-emergency': 'inc_multi_flood_emergency',
  'incident-multi-winter-storm': 'inc_multi_winter_storm',
  'incident-multi-landslide': 'inc_multi_landslide',
  'incident-multi-train-derailment': 'inc_multi_train_derailment',
  'incident-multi-tunnel-fire': 'inc_multi_tunnel_fire',
  'incident-multi-stadium-crush': 'inc_multi_stadium_crush',
  'incident-multi-industrial-explosion': 'inc_multi_industrial_explosion',
  'incident-multi-hospital-evacuation': 'inc_multi_hospital_evacuation',
  'incident-multi-aircraft-accident': 'inc_multi_aircraft_accident',
  'incident-multi-bridge-collapse': 'inc_multi_bridge_collapse',
  'incident-multi-earthquake': 'inc_multi_earthquake',
  'incident-pol-brawl': 'inc_pol_brawl',
  'incident-pol-theft-in-progress': 'cat_crime',
  'incident-pol-alarm-activation': 'inc_pol_alarm_activation',
  'incident-pol-accident-survey': 'inc_pol_accident_survey',
  'incident-pol-missing-person': 'cat_missing_person',
  'incident-pol-suspicious-package': 'cat_suspicious_package',
  'incident-pol-public-event': 'inc_pol_public_event',
  'incident-pol-traffic-disruption': 'inc_pol_traffic_disruption',
  'incident-pol-noise-complaint': 'inc_pol_noise_complaint',
  'incident-pol-parking-obstruction': 'inc_pol_parking_obstruction',
  'incident-pol-shoplifting': 'inc_pol_shoplifting',
  'incident-pol-vandalism': 'inc_pol_vandalism',
  'incident-pol-stray-animal-road': 'inc_pol_stray_animal_road',
  'incident-pol-domestic-disturbance': 'inc_pol_domestic_disturbance',
  'incident-pol-dui-checkpoint': 'inc_pol_dui_checkpoint',
  'incident-pol-road-rage': 'inc_pol_road_rage',
  'incident-pol-burglary-report': 'inc_pol_burglary_report',
  'incident-pol-atm-attack': 'inc_pol_atm_attack',
  'incident-pol-vehicle-pursuit': 'inc_pol_vehicle_pursuit',
  'incident-pol-missing-child': 'inc_pol_missing_child',
  'incident-pol-demonstration': 'inc_pol_demonstration',
  'incident-pol-armed-robbery': 'inc_pol_armed_robbery',
  'incident-pol-drug-operation': 'inc_pol_drug_operation',
  'incident-pol-hostage-situation': 'inc_pol_hostage_situation',
  'incident-pol-stadium-disorder': 'inc_pol_stadium_disorder',
  'incident-pol-public-attack': 'inc_pol_public_attack',
  'incident-wf-brush': 'inc_wf_brush',
  'incident-wf-forest-small': 'cat_wildfire',
  'incident-wf-forest-medium': 'inc_wf_forest_medium',
  'incident-wf-forest-large': 'inc_wf_forest_large',
  'incident-wf-interface': 'inc_wf_interface',
  'incident-wf-roadside-verge': 'inc_wf_roadside_verge',
  'incident-wf-stubble-field': 'inc_wf_stubble_field',
  'incident-wf-pruning-burn': 'inc_wf_pruning_burn',
  'incident-wf-waste-dump': 'inc_wf_waste_dump',
  'incident-wf-reignition': 'inc_wf_reignition',
  'incident-wf-powerline-corridor': 'inc_wf_powerline_corridor',
  'incident-wf-night-front': 'inc_wf_night_front',
  'incident-wf-steep-slope': 'inc_wf_steep_slope',
  'incident-wf-campsite-threat': 'inc_wf_campsite_threat',
  'incident-wf-multiple-ignitions': 'inc_wf_multiple_ignitions',
};

/** Capabilities and families map 1:1 by name (`capability-k9-search` → `cap_k9_search`). */
const byName = (prefix: string, target: string, names: readonly string[]): Record<string, PictogramName> =>
  Object.fromEntries(
    names.map((n) => [`${prefix}${n.slice(target.length).replaceAll('_', '-')}`, n as PictogramName]),
  );

const OTHERS: Record<string, PictogramName> = {
  'item-foam': 'item_foam',
  'item-absorbent': 'item_absorbent',
  'item-extrication-kit': 'item_extrication_kit',
  'item-medical-pack': 'item_medical_pack',
  'item-trauma-pack': 'item_trauma_pack',
  'item-oxygen': 'item_oxygen',
  'item-retardant': 'item_retardant',
  'upgrade-garage': 'upgrade_garage',
  'upgrade-quarters': 'upgrade_quarters',
  'upgrade-storage': 'upgrade_storage',
  'upgrade-workshop': 'upgrade_workshop',
  'upgrade-training-room': 'upgrade_training_room',
  'upgrade-helipad': 'helipad',
  'upgrade-pier': 'upgrade_pier',
  'role-firefighter': 'role_firefighter',
  'role-driver-operator': 'role_driver_operator',
  'role-team-leader': 'role_team_leader',
  'role-rescuer': 'role_rescuer',
  'role-driver': 'role_driver',
  'role-nurse': 'role_nurse',
  'role-physician': 'role_physician',
  'role-officer': 'role_officer',
  'role-specialist': 'role_specialist',
  'role-wildland-operator': 'role_wildland_operator',
  'role-alpine-rescuer': 'role_alpine_rescuer',
  'role-pilot': 'role_pilot',
  'qualification-heavy-vehicle-license': 'qual_heavy_vehicle_license',
  'qualification-emergency-driving': 'qual_emergency_driving',
  'qualification-road-rescue': 'qual_road_rescue',
  'qualification-aerial-ladder-operator': 'qual_aerial_ladder_operator',
  'qualification-crane-operator': 'qual_crane_operator',
  'qualification-saf': 'qual_saf',
  'qualification-nbcr': 'qual_nbcr',
  'qualification-usar': 'qual_usar',
  'qualification-diver': 'qual_diver',
  'qualification-boat-operator': 'qual_boat_operator',
  'qualification-incident-command': 'qual_incident_command',
  'qualification-blsd': 'qual_blsd',
  'qualification-als': 'qual_als',
  'qualification-pediatric-care': 'qual_pediatric_care',
  'qualification-mci-management': 'qual_mci_management',
  'qualification-hems-crew': 'qual_hems_crew',
  'qualification-motorcycle-patrol': 'qual_motorcycle_patrol',
  'qualification-traffic-investigation': 'qual_traffic_investigation',
  'qualification-public-order': 'qual_public_order',
  'qualification-k9-handler': 'qual_k9_handler',
  'qualification-eod-tech': 'qual_eod_tech',
  'qualification-forensics': 'qual_forensics',
  'qualification-tactical-ops': 'qual_tactical_ops',
  'qualification-wildland-firefighting': 'qual_wildland_firefighting',
  'qualification-wildland-command': 'qual_wildland_command',
  'qualification-mountain-rescue-tech': 'qual_mountain_rescue_tech',
  'qualification-avalanche-rescue': 'qual_avalanche_rescue',
  'qualification-snow-vehicle': 'qual_snow_vehicle',
  'qualification-heli-pilot': 'qual_heli_pilot',
  'qualification-airplane-pilot': 'qual_airplane_pilot',
  'qualification-winch-operator': 'qual_winch_operator',
  'hospital-general-emergency': 'hosp_general_emergency',
  'hospital-intensive-care': 'hosp_intensive_care',
  'hospital-cardiology': 'hosp_cardiology',
  'hospital-stroke-unit': 'hosp_stroke_unit',
  'hospital-trauma-center': 'hosp_trauma_center',
  'hospital-pediatrics': 'hosp_pediatrics',
  'hospital-obstetrics': 'hosp_obstetrics',
  'hospital-burn-unit': 'hosp_burn_unit',
  'hospital-toxicology': 'hosp_toxicology',
  'hospital-helipad': 'helipad',
};

/** The complete explicit table: catalog icon key → pictogram (the living style guide and the tests iterate it). */
export const CATALOG_ICONS: Readonly<Record<string, PictogramName>> = {
  ...Object.fromEntries(Object.entries(VEHICLES).map(([key, [pictogram]]) => [key, pictogram])),
  ...FACILITIES,
  ...INCIDENTS,
  ...byName('capability-', 'cap_', CAPABILITY_NAMES),
  ...byName('family-', 'family_', FAMILY_ICONS),
  ...OTHERS,
};

/**
 * Major incident scenarios (`major-incidents.yaml` `icon`, D-24) → the pictogram of the incident that best depicts the
 * whole event. Kept apart from `CATALOG_ICONS` (whose every template has a DIFFERENT glyph): a major reuses an incident's.
 */
export const MAJOR_ICONS: Readonly<Record<string, PictogramName>> = {
  'major-residential-fire': 'inc_fire_apartment_block',
  'major-highway-pileup': 'inc_multi_road_accident',
  'major-storm-damage': 'cat_weather',
  'major-heatwave': 'inc_multi_heatwave_surge',
  'major-gas-explosion': 'cat_gas_leak',
  'major-industrial-fire': 'inc_fire_industrial_plant',
  'major-school-emergency': 'inc_multi_school_evacuation',
  'major-public-event': 'inc_pol_public_event',
  'major-mass-casualty': 'cat_mass_casualty',
  'major-wildfire-front': 'inc_wf_forest_large',
  'major-mountain-rescue': 'inc_alp_stranded_group',
  'major-winter-storm': 'inc_multi_winter_storm',
  'major-hazmat-release': 'inc_multi_hazmat_spill',
  'major-structural-collapse': 'inc_multi_building_collapse',
};
/** A major scenario's pictogram (a newer catalog's unknown scenario: the mass-casualty glyph). */
export const majorIconName = (key: string | null | undefined): PictogramName =>
  (key ? MAJOR_ICONS[key] : undefined) ?? 'cat_mass_casualty';

/** True when the key has its own entry in the explicit tables (false = a prefix fallback would be used). */
export const hasCatalogIcon = (key: string): boolean => key in CATALOG_ICONS;

/** Top-down map glyph class of a vehicle: accepts a class name (legacy payloads) or a catalog icon key. */
export function vehicleClassOf(icon: string | null | undefined): VehicleClass {
  if (!icon) return 'truck';
  if ((VEHICLE_CLASSES as readonly string[]).includes(icon)) return icon as VehicleClass;
  return VEHICLES[icon]?.[1] ?? (icon.startsWith('ung-') ? 'utility' : 'truck');
}

/** Side-view pictogram of a vehicle type: accepts a class name (legacy payloads) or a catalog icon key. */
export function vehiclePictogramOf(icon: string | null | undefined): PictogramName {
  return (icon ? VEHICLES[icon]?.[0] : undefined) ?? `veh_${vehicleClassOf(icon)}`;
}

export function incidentIconName(category: string, icon?: string | null): PictogramName | null {
  return (icon ? INCIDENTS[icon] : undefined) ?? CATEGORY[category.toUpperCase()] ?? null;
}

/** Catalog facility TYPE code (`FIRE_COMMAND`) → its catalog icon key (`facility-fire-command`). Keys pass through. */
export const facilityIconKey = (typeCodeOrKey: string): string =>
  typeCodeOrKey.startsWith('facility-')
    ? typeCodeOrKey
    : `facility-${typeCodeOrKey.toLowerCase().replaceAll('_', '-')}`;

const FACILITY_FAMILY: Record<string, PictogramName> = {
  fire: 'facility_fire',
  ems: 'facility_ems',
  police: 'facility_police',
  aib: 'facility_wildfire',
  wildfire: 'facility_wildfire',
  alpine: 'facility_alpine',
};

/**
 * Any catalog icon key → a pictogram of the set (vehicles, facilities, incidents, capabilities, UNG, items, roles…).
 * Feature code uses ONLY this function for catalog-driven icons, so the icon set can grow without touching the screens.
 */
export function catalogIconName(key: string | null | undefined): PictogramName {
  if (!key) return 'cat_generic';
  const known = CATALOG_ICONS[key];
  if (known) return known;
  // Fallbacks for keys of a catalog newer than this client.
  if (key.startsWith('vehicle-')) return 'veh_truck';
  if (key.startsWith('ung-')) return 'veh_utility';
  if (key.startsWith('capability-')) return 'cap_logistics';
  if (key.startsWith('facility-'))
    return key.includes('coordination')
      ? 'facility_coordination'
      : (FACILITY_FAMILY[key.split('-')[1] ?? ''] ?? 'facility_coordination');
  if (key.startsWith('family-')) return 'family_ung';
  if (key.startsWith('hospital-')) return 'hospital';
  if (key.startsWith('item-')) return 'item_generic';
  if (key.startsWith('upgrade-')) return 'upgrade_generic';
  if (key.startsWith('role-')) return 'role_generic';
  if (key.startsWith('qualification-')) return 'qualification';
  if (key.startsWith('course-')) return 'course';
  return 'cat_generic';
}
