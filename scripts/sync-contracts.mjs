// Copies the shared wire contract from the backend repo. The copy is read-only: never edit src/contracts.
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, process.env.CONTRACTS_SRC ?? '../rescue-control-backend/contracts/src');
const target = resolve(root, 'src/contracts');

if (!existsSync(source)) {
  console.error(`contracts source not found: ${source}`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
writeFileSync(
  resolve(target, 'README.md'),
  '# GENERATED COPY — do not edit\n\nSource: `rescue-control-backend/contracts/src`. Refresh with `pnpm sync:contracts`.\n',
);
console.log(`contracts synced from ${source}`);
