import type { z } from 'zod';
import type { CatalogDto, UnlockDto } from '@/contracts';
import {
  CAPABILITIES,
  CATALOG_I18N_HASH,
  CATALOG_VERSION,
  COURSES,
  FACILITY_TYPES,
  FAMILIES,
  FEATURES,
  INCIDENT_TEMPLATES,
  ITEM_TYPES,
  LEVELS,
  QUALIFICATIONS,
  RANKS,
  ROLES,
  UNG_TYPES,
  UPGRADE_TYPES,
  VEHICLE_TYPES,
  resolvedFamilyLevel,
} from './data/catalog';
import { text, type MockCareer, type MockEngine } from './engine';

/** Lock reason of something that belongs to a service family and has a level gate. */
export function lockReason(career: MockCareer, family: string, level: number): string | null {
  if (family !== 'SHARED' && !career.summary.unlockedFamilies.includes(family as 'FIRE'))
    return 'NOT_UNLOCKED';
  return level > career.summary.level ? 'LEVEL_TOO_LOW' : null;
}

/** GET /careers/:id/catalog — text keys are relative to the catalog i18n bundle (`vehicle.FIRE_APS.name`). */
export function catalogDto(engine: MockEngine, career: MockCareer): z.infer<typeof CatalogDto> {
  const level = career.summary.level;
  return {
    version: CATALOG_VERSION,
    i18nHash: CATALOG_I18N_HASH,
    families: FAMILIES.map((f) => ({
      code: f.code,
      name: text(`family.${f.code}.name`),
      color: f.color,
      requiredLevel: resolvedFamilyLevel(f.code),
      icon: f.icon,
      playerManaged: f.playerManaged,
      unlocked: f.playerManaged ? career.summary.unlockedFamilies.includes(f.code) : true,
      spawnsIncidents: f.playerManaged,
    })),
    capabilities: CAPABILITIES.map((c) => ({
      code: c.code,
      name: text(`capability.${c.code}.name`),
      icon: c.icon,
      group: c.group,
    })),
    vehicleTypes: VEHICLE_TYPES.map((v) => {
      const reason = lockReason(career, v.family, Math.max(v.requiredLevel, resolvedFamilyLevel(v.family)));
      return {
        code: v.code,
        family: v.family,
        domain: v.domain,
        name: text(`vehicle.${v.code}.name`),
        description: text(`vehicle.${v.code}.description`),
        shortName: text(`vehicle.${v.code}.short`),
        price: String(v.price),
        requiredLevel: Math.max(v.requiredLevel, resolvedFamilyLevel(v.family)),
        capacityPoints: v.capacityPoints,
        crewMin: v.crewMin,
        crewOptimal: v.crewOptimal,
        speedFactor: v.speedFactor,
        deliverySeconds: Math.round(v.deliverySeconds / engine.speed),
        capabilities: Object.entries(v.caps).map(([code, value]) => ({ code, value })),
        compatibleFacilityTypes: v.compatibleFacilityTypes,
        icon: v.icon,
        unlocked: reason === null,
        lockedReason: reason,
        movement: v.movement,
        airSpeedKmh: v.airSpeedKmh,
        sirenFactor: v.sirenFactor,
        preparationSeconds: Math.round(v.preparationSeconds / engine.speed),
        tags: v.tags,
      };
    }),
    facilityTypes: FACILITY_TYPES.map((f) => {
      const familyLevel = f.family === 'SHARED' ? 1 : resolvedFamilyLevel(f.family);
      const reason = lockReason(career, f.family, Math.max(f.requiredLevel, familyLevel));
      return {
        code: f.code,
        family: f.family,
        name: text(`facility.${f.code}.name`),
        description: text(`facility.${f.code}.description`),
        tier: f.tier,
        price: String(f.price),
        requiredLevel: Math.max(f.requiredLevel, familyLevel),
        domains: f.domains,
        baseCapacity: f.baseCapacity,
        icon: f.icon,
        unlocked: reason === null,
        lockedReason: reason,
        chain: f.chain,
        upgradeCaps: f.upgradeCaps,
        setupSeconds: Math.round(f.setupSeconds / engine.speed),
        promotion: f.promotion
          ? {
              to: f.promotion.to,
              cost: String(f.promotion.cost),
              buildSeconds: Math.round(f.promotion.buildSeconds / engine.speed),
              requiredUpgradeLevels: f.promotion.requiredUpgradeLevels,
            }
          : null,
        effects: f.effects,
      };
    }),
    facilityUpgrades: UPGRADE_TYPES.map((u) => ({
      code: u.code,
      name: text(`upgrade.${u.code}.name`),
      description: text(`upgrade.${u.code}.description`),
      requiredLevel: u.requiredLevel,
      basePrice: String(u.basePrice),
      costGrowth: u.costGrowth,
      baseBuildSeconds: Math.round(u.buildSeconds / engine.speed),
      buildGrowth: u.buildGrowth,
      maxLevel: u.maxLevel,
      effect: { domain: u.domain, delta: u.delta },
    })),
    ungUnitTypes: UNG_TYPES.map((u) => ({
      code: u.code,
      name: text(`ung.${u.code}.name`),
      icon: u.icon,
      keepsRoadClosed: u.keepsRoadClosed,
    })),
    incidentTemplates: INCIDENT_TEMPLATES.map((t) => ({
      code: t.code,
      category: t.category,
      primaryFamily: t.primaryFamily,
      families: t.families,
      requiredLevel: t.minLevel,
      rarity: t.rarity,
      title: text(`incident.${t.code}.title`),
      icon: t.icon,
      severityMin: t.severity[0],
      severityMax: t.severity[1],
      unlocked: t.minLevel <= level && career.summary.unlockedFamilies.includes(t.primaryFamily),
    })),
    levels: LEVELS.map((l) => ({
      level: l.level,
      xpToNext: String(l.xpToNext),
      stipendBase: String(l.stipendBase),
      levelUpCredits: String(l.levelUpCredits),
      maxActiveIncidents: l.maxActiveIncidents,
    })),
    ranks: RANKS.map((r) => ({ ...r, name: text(`rank.${r.code}.name`) })),
    features: FEATURES.map((f) => ({ ...f, unlocked: f.requiredLevel <= level })),
    items: ITEM_TYPES,
    roles: ROLES,
    qualifications: QUALIFICATIONS,
    courses: COURSES,
  };
}

/** GET /careers/:id/progression/unlocks */
export function unlockList(career: MockCareer): UnlockDto[] {
  const level = career.summary.level;
  const rows: UnlockDto[] = [
    ...FAMILIES.filter((f) => f.playerManaged).map((f) => ({
      code: f.code,
      kind: 'FAMILY' as const,
      name: text(`family.${f.code}.name`),
      requiredLevel: resolvedFamilyLevel(f.code),
      unlocked: resolvedFamilyLevel(f.code) <= level,
      family: f.code,
    })),
    ...VEHICLE_TYPES.map((v) => {
      const required = Math.max(v.requiredLevel, resolvedFamilyLevel(v.family));
      return {
        code: v.code,
        kind: 'VEHICLE_TYPE' as const,
        name: text(`vehicle.${v.code}.name`),
        requiredLevel: required,
        unlocked: required <= level,
        family: v.family,
      };
    }),
    ...FACILITY_TYPES.map((f) => {
      const required = Math.max(f.requiredLevel, f.family === 'SHARED' ? 1 : resolvedFamilyLevel(f.family));
      return {
        code: f.code,
        kind: 'FACILITY_TYPE' as const,
        name: text(`facility.${f.code}.name`),
        requiredLevel: required,
        unlocked: required <= level,
        family: f.family === 'SHARED' ? null : f.family,
      };
    }),
    ...FEATURES.map((f) => ({
      code: f.feature,
      kind: 'FEATURE' as const,
      name: text(`feature.${f.feature}.name`),
      requiredLevel: f.requiredLevel,
      unlocked: f.requiredLevel <= level,
      family: null,
    })),
  ];
  return rows.sort((a, b) => a.requiredLevel - b.requiredLevel);
}
