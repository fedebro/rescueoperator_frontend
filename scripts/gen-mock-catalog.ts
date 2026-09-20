/**
 * pnpm gen:mock-catalog
 * Builds the bundled copy of the game catalog used by the mock backend (and by unit tests):
 *   src/mocks/data/generated/catalog.json        — slim, typed-by-adapter view of ../rescue-control-backend/catalog/data/*.yaml
 *   src/mocks/data/generated/i18n/<locale>.json  — exactly the `CatalogI18nBundle` served by GET /public/i18n/catalog/:locale
 * The real backend serves the same content; never edit the generated files by hand.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogDir = resolve(root, '../rescue-control-backend/catalog');
const outDir = join(root, 'src/mocks/data/generated');
const LOCALES = ['it', 'en', 'fr', 'de', 'es'];

type Obj = Record<string, unknown>;
const data = <T = Obj>(file: string): T => parse(readFileSync(join(catalogDir, 'data', file), 'utf8')) as T;
const pick = (o: Obj, keys: string[]): Obj =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

const templates = readdirSync(join(catalogDir, 'data/incident-templates'))
  .filter((f) => f.endsWith('.yaml'))
  .sort()
  .flatMap((f) => data<{ incidentTemplates: Obj[] }>(`incident-templates/${f}`).incidentTemplates);

const levels = data<{ maxLevel: number; ranks: Obj[]; levels: Obj[] }>('levels.yaml');
const roles = data<{ parameters: Obj; roles: Obj[] }>('personnel-roles.yaml');
const economy = data<Obj>('economy.yaml');
const meta = data<Obj>('catalog.yaml');

const catalog = {
  version: String(meta.version),
  families: data<{ families: Obj[] }>('service-families.yaml').families,
  capabilities: data<{ capabilities: Obj[] }>('capabilities.yaml').capabilities.map((c) =>
    pick(c, ['code', 'group', 'icon']),
  ),
  vehicleTypes: data<{ vehicleTypes: Obj[] }>('vehicle-types.yaml').vehicleTypes.map((v) => ({
    ...pick(v, [
      'code',
      'family',
      'domain',
      'capabilities',
      'tags',
      'price',
      'requiredLevel',
      'capacityPoints',
      'crew',
      'speedFactor',
      'sirenFactor',
      'airSpeedKmh',
      'preparationSeconds',
      'deliverySeconds',
      'patientCapacity',
      'baseFailureRate',
      'maintenance',
      'compatibleFacilityTypes',
      'icon',
    ]),
    movement:
      (data<{ mobilityProfiles: Obj[] }>('vehicle-types.yaml').mobilityProfiles.find(
        (m) => m.code === v.mobilityProfile,
      )?.movement as string | undefined) ?? 'ROAD',
  })),
  facilityTypes: data<{ facilityTypes: Obj[] }>('facility-types.yaml').facilityTypes.map((f) =>
    pick(f, [
      'code',
      'family',
      'chain',
      'tier',
      'domains',
      'baseCapacity',
      'upgradeCaps',
      'price',
      'requiredLevel',
      'setupSeconds',
      'promotion',
      'effects',
      'icon',
    ]),
  ),
  upgrades: data<{ upgrades: Obj[] }>('facility-upgrades.yaml').upgrades,
  ungUnitTypes: data<{ ungUnitTypes: Obj[] }>('ung-unit-types.yaml').ungUnitTypes.map((u) =>
    pick(u, ['code', 'icon', 'arrival', 'work', 'keepsRoadClosed']),
  ),
  itemTypes: data<{ itemTypes: Obj[] }>('item-types.yaml').itemTypes.map((i) =>
    pick(i, [
      'code',
      'family',
      'requiredLevel',
      'unitPrice',
      'packSize',
      'deliverySeconds',
      'starterStock',
      'lowStockThreshold',
      'icon',
    ]),
  ),
  roles: roles.roles.map((r) =>
    pick(r, [
      'code',
      'family',
      'specialist',
      'requiredLevel',
      'hireCost',
      'costPerPeriod',
      'onboardingSeconds',
      'startingQualifications',
      'quickHire',
      'icon',
    ]),
  ),
  personnelParameters: roles.parameters,
  qualifications: data<{ qualifications: Obj[] }>('qualifications.yaml').qualifications.map((q) =>
    pick(q, ['code', 'families', 'roles', 'tier', 'icon']),
  ),
  courses: data<{ courses: Obj[] }>('training-courses.yaml').courses.map((c) =>
    pick(c, ['code', 'grants', 'tier', 'durationSeconds', 'cost', 'requiredLevel', 'prerequisites']),
  ),
  patientProfiles: data<{ patientProfiles: Obj[] }>('patient-profiles.yaml').patientProfiles.map((p) =>
    pick(p, ['code', 'category', 'triage', 'stability', 'treatment', 'transport', 'hospital']),
  ),
  hospitalCapabilities: data<{ hospitalCapabilities: Obj[] }>(
    'hospital-capabilities.yaml',
  ).hospitalCapabilities.map((h) => pick(h, ['code', 'icon'])),
  incidentTemplates: templates.map((t) => ({
    ...pick(t, [
      'code',
      'category',
      'group',
      'primaryFamily',
      'families',
      'requiredLevel',
      'tutorial',
      'rarity',
      'weight',
      'expirySeconds',
      'reward',
      'consumables',
      'icon',
    ]),
    severity: pick(t.severity as Obj, ['min', 'max', 'distribution']),
    bands: (t.bands as Obj[]).map((b) =>
      pick(b, ['severity', 'minLevel', 'requirements', 'workUnits', 'patients', 'ung']),
    ),
  })),
  maxLevel: levels.maxLevel,
  ranks: levels.ranks.map((r) => pick(r, ['code', 'fromLevel', 'toLevel'])),
  levels: levels.levels.map((l) =>
    pick(l, ['level', 'xpToNext', 'cumulativeXp', 'stipendBase', 'levelUpCredits', 'maxActiveIncidents']),
  ),
  features: data<{ features: Obj[] }>('unlocks.yaml').features,
  milestones: data<{ milestones: Obj[] }>('milestones.yaml').milestones.map((m) =>
    pick(m, ['code', 'order', 'phase', 'trigger', 'rewardCredits', 'rewardXp']),
  ),
  starterPackage: data<Obj>('starter-package.yaml'),
  economy: pick(economy, [
    'startingCredits',
    'stipend',
    'creditPackages',
    'rewardedAds',
    'referral',
    'speedup',
    'maintenance',
    'medical',
  ]),
};

/** Flatten nested YAML texts to dotted keys; arrays (incident report blocks) stay arrays — same as the backend bundle. */
function flatten(tree: Obj, prefix = '', out: Record<string, string | string[]> = {}) {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (Array.isArray(v)) out[key] = v.map(String);
    else if (v && typeof v === 'object') flatten(v as Obj, key, out);
  }
  return out;
}

mkdirSync(join(outDir, 'i18n'), { recursive: true });
const bundles = LOCALES.map((locale) => ({
  locale,
  messages: flatten(parse(readFileSync(join(catalogDir, 'i18n', `${locale}.yaml`), 'utf8')) as Obj),
}));
const hash = createHash('sha256').update(JSON.stringify(bundles)).digest('hex').slice(0, 12);
for (const b of bundles)
  writeFileSync(
    join(outDir, 'i18n', `${b.locale}.json`),
    JSON.stringify({ locale: b.locale, catalogVersion: catalog.version, hash, messages: b.messages }) + '\n',
  );
writeFileSync(join(outDir, 'catalog.json'), JSON.stringify({ ...catalog, i18nHash: hash }) + '\n');
console.log(
  `mock catalog ${catalog.version} (${hash}): ${catalog.vehicleTypes.length} vehicles, ${catalog.facilityTypes.length} facilities, ` +
    `${catalog.incidentTemplates.length} templates, ${Object.keys(bundles[0]!.messages).length} texts × ${LOCALES.length} locales`,
);
