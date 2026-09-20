import { expect, test, type Page } from '@playwright/test';
import { bootCareer, isMobile, qa, trackProblems } from './helpers';

/**
 * Admin panel (Spec 18) against the mock backend, on both layouts: dense tables on desktop, cards + drawer on phones.
 * Staff accounts of the mock: admin@ (SUPER_ADMIN) · gameadmin@ (GAME_ADMIN) · support@ (SUPPORT), OTP 123456.
 */
trackProblems();

const ADMIN = 'admin@rescue-control.test';
const SUPPORT = 'support@rescue-control.test';

/** A normal player career that the staff account will inspect. Must run before `bootCareer` (it signs the player in). */
async function createPlayer(page: Page, tag: string): Promise<{ careerId: string; directorName: string }> {
  await page.goto('/auth');
  await page.waitForFunction(() => '__rcMock' in window);
  const directorName = `Giocatore ${tag}${Date.now() % 100000}`;
  const { careerId } = await qa<{ careerId: string }>(page, 'createReadyCareer', {
    email: `player.${tag}.${Date.now()}@example.com`,
    directorName,
    credits: 20000,
  });
  return { careerId, directorName };
}

async function openSection(page: Page, name: string): Promise<void> {
  if (isMobile(page)) await page.getByRole('button', { name: 'Apri il menu' }).click();
  await page
    .getByRole('navigation', { name: 'Navigazione amministrazione' })
    .getByRole('link', { name })
    .click();
}

async function searchById(page: Page, id: string): Promise<void> {
  const search = page.getByRole('searchbox', { name: 'Cerca per ID' });
  await search.fill(id);
  await search.press('Enter');
}

test('environment banner, dashboard and navigation', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { email: ADMIN });
  await page.goto('/admin');
  const banner = page.getByTestId('admin-env-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Ambiente: Simulato');
  await expect(page.getByRole('heading', { name: 'Panoramica' })).toBeVisible();
  await expect(page.getByTestId('kpi-revenue30d')).toContainText('€');
  await expect(page.getByTestId('admin-updated-at')).toContainText('Aggiornato alle');
  await expect(page.getByText('scheduled-actions').first()).toBeVisible();
  await expect(page.getByText('Degradato')).toBeVisible();

  // The search only accepts inspectable ids.
  await searchById(page, 'veh_123');
  await expect(
    page.getByText('Incolla un ID utente (usr_), carriera (car_) o emergenza (inc_).'),
  ).toBeVisible();

  await openSection(page, 'Catalogo');
  await expect(page.getByRole('heading', { name: 'Catalogo dei contenuti' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Cerca per nome, codice o servizio' }).fill('FIRE_APS');
  await expect(page.getByText('FIRE_APS', { exact: true }).first()).toBeVisible();

  await openSection(page, 'Funzioni');
  await expect(page.getByRole('switch', { name: 'rewardedAds' })).toBeVisible();
  // The banner never goes away while moving around.
  await expect(banner).toBeVisible();
});

test('credit adjustment goes through the ledger with a reason and is audited', async ({ page }, info) => {
  const player = await createPlayer(page, info.project.name);
  await bootCareer(page, info.project.name, { email: ADMIN });
  await page.goto('/admin');
  await searchById(page, player.careerId);
  await expect(page.getByRole('heading', { name: player.directorName })).toBeVisible();
  await expect(page.getByTestId('career-balance')).toContainText('20.000');

  await page.getByRole('button', { name: 'Rettifica Crediti' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rettifica Crediti' });
  await dialog.getByRole('button', { name: 'Rivedi la rettifica' }).click();
  await expect(dialog.getByText('Inserisci un intero diverso da zero.')).toBeVisible();
  await expect(dialog.getByText('Indica un motivo di almeno 5 caratteri.')).toBeVisible();

  // Never below zero: the preview blocks it before the server would.
  await dialog.getByLabel('Importo').fill('-50000');
  await expect(dialog.getByText('Il saldo non può scendere sotto zero.')).toBeVisible();
  await dialog.getByLabel('Importo').fill('250');
  await expect(dialog.getByTestId('credit-preview')).toContainText('20.250');
  await dialog.getByLabel('Motivo').fill('Compensazione per il disservizio di ieri');
  await dialog.getByRole('button', { name: 'Rivedi la rettifica' }).click();

  const confirm = page.getByRole('dialog', { name: 'Confermare la rettifica?' });
  await expect(confirm).toContainText(player.careerId);
  await expect(confirm).toContainText('Compensazione per il disservizio di ieri');
  await confirm.getByRole('button', { name: 'Registra la rettifica' }).click();
  await expect(page.getByText('Rettifica registrata. Nuovo saldo: 20.250')).toBeVisible();
  await expect(page.getByTestId('career-balance')).toContainText('20.250');

  await page.getByRole('tab', { name: 'Registro Crediti' }).click();
  const ledger = isMobile(page)
    ? page.getByRole('list', { name: 'Registro Crediti' })
    : page.getByRole('table', { name: 'Registro Crediti' });
  await expect(ledger.getByText('ADMIN_ADJUSTMENT').first()).toBeVisible();
  await expect(ledger.getByText('+250').first()).toBeVisible();

  await openSection(page, 'Registro attività');
  await expect(page.getByText('career.credit_adjustment').first()).toBeVisible();
  await expect(
    page.getByText('COMPENSATION 250: Compensazione per il disservizio di ieri').first(),
  ).toBeVisible();
});

test('config: draft, schema validation, diff, publish with typed confirmation', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { email: ADMIN });
  await page.goto('/admin/config');
  await page.getByRole('button', { name: 'Crea bozza dalla versione pubblicata' }).click();
  await expect(page.getByRole('heading', { name: 'Configurazione mock-2' })).toBeVisible();

  const editor = page.getByTestId('config-editor');
  const original = await editor.inputValue();
  const save = page.getByRole('button', { name: 'Salva bozza' });

  // Invalid against the schema → error path shown, saving blocked.
  await editor.fill(original.replace('"rewardMultiplier": 1', '"rewardMultiplier": "tanto"'));
  const validation = page.getByTestId('config-validation');
  await expect(validation).toHaveAttribute('data-valid', 'false');
  await expect(validation).toContainText('/economy/rewardMultiplier');
  await expect(save).toBeDisabled();
  // Broken JSON → syntax error with its line, still blocked.
  await editor.fill(original.replace('"rewardMultiplier": 1,', '"rewardMultiplier": ,'));
  await expect(validation).toContainText('JSON non valido alla riga');
  await expect(save).toBeDisabled();

  // Fixed → valid, the diff shows old → new.
  await editor.fill(original.replace('"rewardMultiplier": 1', '"rewardMultiplier": 1.5'));
  await expect(validation).toHaveAttribute('data-valid', 'true');
  const diff = page.getByTestId('config-diff').first();
  await expect(diff).toContainText('economy.rewardMultiplier');
  await expect(diff).toContainText('Modificato');
  await expect(diff).toContainText('1.5');
  await save.click();
  await expect(page.getByText('Bozza salvata')).toBeVisible();

  await page.getByRole('button', { name: 'Pubblica', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Pubblicare questa versione?' });
  await dialog.getByRole('button', { name: 'Pubblica', exact: true }).click();
  await expect(dialog.getByText('Scrivi un motivo di almeno 5 caratteri.')).toBeVisible();
  await dialog.getByLabel('Motivo').fill('Bilanciamento approvato dal game design');
  await dialog.getByLabel('Per confermare scrivi «mock-2»').fill('mock-3');
  await dialog.getByRole('button', { name: 'Pubblica', exact: true }).click();
  await expect(dialog.getByText('Il testo non corrisponde.')).toBeVisible();
  await dialog.getByLabel('Per confermare scrivi «mock-2»').fill('mock-2');
  await dialog.getByRole('button', { name: 'Pubblica', exact: true }).click();
  await expect(page.getByText('Versione mock-2 pubblicata')).toBeVisible();
  await expect(page.getByTestId('config-status-PUBLISHED')).toBeVisible();

  await openSection(page, 'Configurazioni');
  const list = isMobile(page)
    ? page.getByRole('list', { name: 'Versioni di configurazione' })
    : page.getByRole('table', { name: 'Versioni di configurazione' });
  const row = (version: string) =>
    list.getByRole(isMobile(page) ? 'listitem' : 'row').filter({ hasText: version });
  await expect(row('mock-2')).toContainText('Pubblicata');
  await expect(row('mock-1')).toContainText('Sostituita');
  // The game is told about the new version.
  expect(
    await page.evaluate(() => {
      const engine = (
        window as unknown as {
          __rcMock: { qa: { career: () => unknown }; snapshot: (c: unknown) => { configVersion: string } };
        }
      ).__rcMock;
      return engine.snapshot(engine.qa.career()).configVersion;
    }),
  ).toBe('mock-2');
});

test('world: a closure from pasted coordinates reaches the game world', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { email: ADMIN });
  await page.goto('/admin/world');
  await expect(page.getByRole('heading', { name: 'Mondo', exact: true })).toBeVisible();
  await page.getByLabel('Coordinate del poligono').fill('42.460, 14.210\n42.470, 14.210\n42.470, 14.225');
  await page.getByRole('button', { name: 'Usa queste coordinate' }).click();
  await expect(page.getByText('Poligono chiuso con 3 punti.')).toBeVisible();
  await page.getByRole('button', { name: 'Crea chiusura' }).click();
  const dialog = page.getByRole('dialog', { name: 'Creare la chiusura?' });
  await dialog.getByLabel('Motivo').fill('Prova di chiusura per il test');
  await dialog.getByRole('button', { name: 'Crea chiusura' }).click();
  await expect(page.getByText('Chiusura creata')).toBeVisible();
  await expect(page.getByText('Chiusure attive (1)')).toBeVisible();
  const closures = await page.evaluate(() => {
    const engine = (
      window as unknown as {
        __rcMock: {
          qa: { career: () => unknown };
          snapshot: (c: unknown) => { world: { closures: { reason: { key: string } }[] } };
        };
      }
    ).__rcMock;
    return engine.snapshot(engine.qa.career()).world.closures.map((c) => c.reason.key);
  });
  expect(closures).toContain('admin.world.reasons.ROADWORKS');
});

test('role guard: support cannot adjust or publish (UI and API), players get the 403 page', async ({
  page,
}, info) => {
  const player = await createPlayer(page, info.project.name);
  await bootCareer(page, info.project.name, { email: SUPPORT });
  await page.goto(`/admin/careers/${player.careerId}`);
  await expect(page.getByRole('heading', { name: player.directorName })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rettifica Crediti' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Genera emergenza di test' })).toHaveCount(0);
  await expect(page.getByText('Il tuo ruolo non consente modifiche qui.')).toBeVisible();

  await page.goto('/admin/config');
  await expect(page.getByRole('heading', { name: 'Versioni di configurazione' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crea bozza dalla versione pubblicata' })).toHaveCount(0);
  await page.goto('/admin/flags');
  await expect(page.getByRole('switch', { name: 'rewardedAds' })).toBeDisabled();

  // The API enforces the same matrix: a direct call with the support token is refused.
  const statuses = await page.evaluate(async (careerId) => {
    const engine = (window as unknown as { __rcMock: { accessTokens: Map<string, string> } }).__rcMock;
    const token = [...engine.accessTokens].find(([, email]) => email.startsWith('support@'))?.[0];
    const call = (path: string, body: unknown) =>
      fetch(`http://localhost:4000/api/v1/admin${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      }).then((r) => r.status);
    return [
      await call(`/careers/${careerId}/credit-adjustment`, {
        amount: '100',
        reasonCode: 'COMPENSATION',
        note: 'Tentativo non consentito',
      }),
      await call('/config/versions/cfg_0001/publish', { reason: 'Tentativo non consentito' }),
    ];
  }, player.careerId);
  expect(statuses).toEqual([403, 403]);

  // Support CAN do its own job: add a note to the player.
  await page.goto('/admin/users');
  await page.getByRole('searchbox', { name: 'Cerca per email, nome o ID' }).fill(player.directorName);
  if (isMobile(page)) await page.getByRole('link', { name: 'Dettagli' }).first().click();
  else await page.getByRole('row').filter({ hasText: player.directorName }).click();
  await page.getByLabel('Nuova nota').fill('Contattato via email');
  await page.getByRole('button', { name: 'Aggiungi nota' }).click();
  await expect(page.getByText('Nota aggiunta')).toBeVisible();
});

test('a normal player gets the translated 403 page', async ({ page }, info) => {
  await bootCareer(page, info.project.name);
  await page.goto('/admin');
  await expect(page.getByTestId('admin-forbidden')).toBeVisible();
  await expect(page.getByText('Accesso non consentito')).toBeVisible();
  await expect(page.getByTestId('admin-env-banner')).toHaveCount(0);
  await page.getByRole('link', { name: 'Torna al gioco' }).click();
  await expect(page).toHaveURL(/\/game$/);
});
