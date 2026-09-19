/**
 * i18n consistency check (pnpm check:i18n):
 *  1. every locale file has exactly the same key set as it.json (the reference) and the same ICU placeholders;
 *  2. every static `t('key')` found in the source exists in it.json; dynamic keys (`t(\`x.${y}\`)`) must match a prefix;
 *  3. no value in a non-Italian locale is left empty.
 * `--list` prints the keys used by the source (handy while authoring).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['it', 'en', 'fr', 'de', 'es'];
type Tree = { [k: string]: Tree | string };
const load = (l: string): Tree =>
  JSON.parse(readFileSync(join(root, 'src/messages', `${l}.json`), 'utf8')) as Tree;
const flatten = (t: Tree, prefix = '', out = new Map<string, string>()) => {
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else flatten(v, key, out);
  }
  return out;
};
/** ICU argument names only (`{name}` / `{name, plural, …}`), not the first word of a plural branch. */
const placeholders = (s: string) =>
  [...new Set([...s.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]!))].sort().join(',');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (!['contracts', 'messages', 'mocks'].includes(f)) walk(p, out);
    } else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

const used = new Set<string>();
const usedPrefixes = new Set<string>();
for (const file of walk(join(root, 'src'))) {
  const src = readFileSync(file, 'utf8');
  // A variable name (t, tc, …) is re-bound in every component of a file: resolve each call against the nearest binding above it.
  const bindings = [
    ...src.matchAll(/const (\w+) = (?:await )?(?:useTranslations|getTranslations)\((?:'([^']*)')?\)/g),
  ].map((m) => ({ name: m[1]!, ns: m[2] ?? '', index: m.index }));
  const nsAt = (name: string, index: number) =>
    bindings.filter((x) => x.name === name && x.index < index).at(-1)?.ns;
  for (const name of new Set(bindings.map((x) => x.name))) {
    const add = (set: Set<string>, m: RegExpMatchArray) => {
      const ns = nsAt(name, m.index ?? 0);
      if (ns !== undefined) set.add(ns ? `${ns}.${m[1]!}` : m[1]!);
    };
    for (const m of src.matchAll(new RegExp(`\\b${name}(?:\\.has|\\.rich)?\\(\\s*'([^']+)'`, 'g')))
      add(used, m);
    for (const m of src.matchAll(new RegExp(`\\b${name}(?:\\.has|\\.rich)?\\(\\s*\`([^\`$]*)\\$\\{`, 'g')))
      add(usedPrefixes, m);
  }
  // nav label keys declared as data
  for (const m of src.matchAll(/labelKey: '([^']+)'/g)) used.add(`game.nav.${m[1]!}`);
}

if (process.argv.includes('--list')) {
  console.log([...used].sort().join('\n'));
  console.log('--- prefixes ---');
  console.log([...usedPrefixes].sort().join('\n'));
  process.exit(0);
}

let errors = 0;
const fail = (msg: string) => {
  errors++;
  console.error(`✗ ${msg}`);
};
const ref = flatten(load('it'));
for (const key of used) if (!ref.has(key)) fail(`missing in it.json: ${key}`);
for (const prefix of usedPrefixes)
  if (![...ref.keys()].some((k) => k.startsWith(prefix))) fail(`no key under dynamic prefix: ${prefix}*`);
for (const locale of LOCALES.slice(1)) {
  const flat = flatten(load(locale));
  for (const [key, value] of ref) {
    const other = flat.get(key);
    if (other === undefined) fail(`${locale}: missing ${key}`);
    else if (other.trim() === '') fail(`${locale}: empty ${key}`);
    else if (placeholders(other) !== placeholders(value))
      fail(`${locale}: placeholders differ for ${key} (${placeholders(value)} vs ${placeholders(other)})`);
  }
  for (const key of flat.keys()) if (!ref.has(key)) fail(`${locale}: extra key ${key}`);
}
if (errors) {
  console.error(`\n${errors} i18n problem(s)`);
  process.exit(1);
}
console.log(`i18n OK — ${ref.size} keys × ${LOCALES.length} locales, ${used.size} static usages checked`);
