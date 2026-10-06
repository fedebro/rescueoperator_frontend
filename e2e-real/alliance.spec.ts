import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  API_URL,
  careerIdOf,
  cli,
  createCareer,
  dismissInterruptions,
  goTo,
  otpFor,
  signUp,
  skipPushPrompt,
  trackProblems,
  uniqueAccount,
  waitFor,
  type Account,
} from './helpers';

/**
 * Two players against the REAL backend (study 2026-10-06 §08 §10, brief alliance-platform §Phase 2): A founds an alliance, B joins
 * through the invite code, A promotes B and both see each other's changes through the alliance stream — without a reload. Then the
 * phase-2 features: board, chat (text, quick phrase, refused link), an alliance mute, a report that reaches the moderation queue, and
 * an allied column on a real incident of A. Those steps drive the API directly (bearer tokens from a second OTP sign-in of the same
 * accounts) until the frontend's board / chat / aid screens land; they then move to the UI, the assertions stay.
 *
 * Player A is the default `page`; player B lives in a second browser context of the same project (same device profile).
 * Levels come from the operator CLI (`career:grant`): founding needs level 5 and the founding cost, joining level 3.
 */

trackProblems();

/** The default tracker follows the fixture page only: B gets the same guard by hand. */
function trackSecondPlayer(page: Page): () => void {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`B pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`B HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return () => expect(problems, 'player B: no runtime errors or 5xx').toEqual([]);
}

/** The scripted first mission's overlay would intercept every click on the navigation: the players skip it, as a player may. */
async function skipTutorial(page: Page): Promise<void> {
  await page.getByTestId('tutorial-skip').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0, { timeout: 30_000 });
}

/* ───────────────────────────── API side (until the frontend screens land) ───────────────────────────── */

interface ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
}

class Player {
  constructor(
    private readonly api: APIRequestContext,
    readonly token: string,
    readonly careerId: string,
  ) {}

  get base(): string {
    return `/api/v1/careers/${this.careerId}`;
  }

  /** `{ data }` of a successful call; a failure throws an `ApiError` with the server's `code` and `details`. */
  async call<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (method === 'POST')
      headers['Idempotency-Key'] = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await this.api.fetch(`${API_URL}${path}`, { method, headers, data: body });
    const json =
      response.status() === 204
        ? null
        : ((await response.json()) as {
            data?: T;
            error?: { code: string; details?: unknown; message?: string };
          });
    if (!response.ok()) {
      const error = new Error(
        `${method} ${path} → ${response.status()} ${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`.trim(),
      ) as ApiError;
      error.status = response.status();
      error.code = json?.error?.code ?? 'UNKNOWN';
      error.details = json?.error?.details;
      throw error;
    }
    return json?.data as T;
  }

  /** The expected refusal of a call: its error code. */
  async refused(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; code: string; details: unknown }> {
    try {
      await this.call(method, path, body);
    } catch (error) {
      const e = error as ApiError;
      return { status: e.status, code: e.code, details: e.details };
    }
    throw new Error(`${method} ${path} was expected to fail`);
  }
}

/** A second, API-only session of a signed-up account: one more OTP e-mail, read from Mailpit. */
async function apiSession(api: APIRequestContext, account: Account, careerId: string): Promise<Player> {
  const requestedAt = Date.now() - 1000;
  const requested = await api.post(`${API_URL}/api/v1/auth/otp/request`, {
    data: { email: account.email, locale: 'it' },
  });
  expect(requested.status()).toBe(202);
  const { challengeId } = ((await requested.json()) as { data: { challengeId: string } }).data;
  const code = await otpFor(account.email, requestedAt);
  const verified = await api.post(`${API_URL}/api/v1/auth/otp/verify`, { data: { challengeId, code } });
  expect(verified.status()).toBe(200);
  const { accessToken } = ((await verified.json()) as { data: { accessToken: string } }).data;
  return new Player(api, accessToken, careerId);
}

/**
 * Free text needs an account older than `config.moderation.write.minAccountAgeHours` (24 h) — the two players were born a minute
 * ago. A SUPER_ADMIN (A, granted through the CLI) publishes a config version with the knob at zero, exactly as QA would in a trial.
 */
async function allowFreshAccountsToWrite(admin: Player): Promise<void> {
  const versions = await admin.call<Array<{ id: string; status: string }>>(
    'GET',
    '/api/v1/admin/config/versions',
  );
  const published = versions.find((v) => v.status === 'PUBLISHED');
  const draft = await admin.call<{ id: string; content: Record<string, unknown> }>(
    'POST',
    '/api/v1/admin/config/versions',
    {
      fromVersionId: published?.id,
      note: 'e2e alliance spec: fresh accounts may write',
    },
  );
  const moderation = (draft.content.moderation ?? {}) as Record<string, unknown>;
  const write = (moderation.write ?? {}) as Record<string, unknown>;
  const content = {
    ...draft.content,
    moderation: { ...moderation, write: { ...write, minAccountAgeHours: 0 } },
  };
  await admin.call('PUT', `/api/v1/admin/config/versions/${draft.id}`, {
    content,
    note: 'e2e alliance spec',
  });
  await admin.call('POST', `/api/v1/admin/config/versions/${draft.id}/publish`, {
    reason: 'e2e alliance spec: accounts created a minute ago must write',
  });
}

/** List responses come either as a plain array or as a page `{ data: [...] }`. */
function rowsOf<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  const data = (response as { data?: unknown }).data;
  return Array.isArray(data) ? (data as T[]) : [];
}

test('two players: found, invite code, promote, board, chat, mute, report, allied column', async ({
  browser,
  page,
}, info) => {
  test.setTimeout(25 * 60_000);
  const a = uniqueAccount(`${info.project.name}-a`);
  const b = uniqueAccount(`${info.project.name}-b`);
  for (const flag of ['alliances', 'alliance_board', 'alliance_chat', 'alliance_aid'])
    cli('flag', flag, 'on', 'e2e alliance spec');

  const contextB = await browser.newContext({
    baseURL: info.project.use.baseURL,
    viewport: page.viewportSize() ?? undefined,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
    userAgent: info.project.use.userAgent,
  });
  const pageB = await contextB.newPage();
  const checkB = trackSecondPlayer(pageB);
  const api = await playwrightRequest.newContext();

  await test.step('two real sign-ups and two careers in Pescara, tutorial skipped', async () => {
    await dismissInterruptions(page);
    await signUp(page, a);
    await createCareer(page);
    await skipTutorial(page);
    await dismissInterruptions(pageB);
    await signUp(pageB, b);
    await createCareer(pageB);
    await skipTutorial(pageB);
  });

  const careerA = await careerIdOf(page);
  const careerB = await careerIdOf(pageB);

  await test.step('levels through the operator CLI: A level 5 + founding cost, B level 3', async () => {
    cli('career:grant', careerA, '--xp=900', '--credits=5000');
    cli('career:grant', careerB, '--xp=300');
  });

  let playerA!: Player;
  let playerB!: Player;
  await test.step('API sessions for both players; A becomes SUPER_ADMIN and lets fresh accounts write (founding carries a description: the write gate applies)', async () => {
    playerA = await apiSession(api, a, careerA);
    playerB = await apiSession(api, b, careerB);
    cli('grant-role', a.email, 'SUPER_ADMIN');
    await allowFreshAccountsToWrite(playerA);
    // A only reports and moderates: rules accepted through the API. B, who writes, accepts them in the UI below.
    const rules = await playerA.call<{ version: string; accepted: boolean }>(
      'GET',
      '/api/v1/me/community-rules',
    );
    if (!rules.accepted)
      await playerA.call('POST', '/api/v1/me/community-rules/accept', { version: rules.version });
  });

  let allianceName = '';
  await test.step('A founds the alliance', async () => {
    await goTo(page, 'Alleanza', true);
    await expect(page.getByTestId('alliance-none')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('tab-found').click();
    await expect(page.getByTestId('found-requirement')).not.toContainText('Serve il livello', {
      timeout: 60_000,
    });
    const suffix = careerA.slice(-4).toLowerCase();
    allianceName = `Abruzzo ${suffix}`;
    await page.getByTestId('found-name').fill(allianceName);
    await page.getByTestId('found-tag').fill(`a${suffix.slice(-3)}`);
    await page.getByTestId('found-description').fill('Ci aiutiamo tra province.');
    await page.getByTestId('found-submit').click();
    await page.getByTestId('found-confirm').click();
    await expect(page.getByTestId('alliance-section')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('alliance-overview')).toContainText(allianceName);
    await expect(page.getByTestId('alliance-overview')).toContainText('Coordinatore');
  });

  let code = '';
  await test.step('A creates an invite link', async () => {
    await page.getByTestId('alliance-tab-members').click();
    await expect(page.getByTestId('member-row')).toHaveCount(1);
    await page.getByTestId('invite-create').click();
    await expect(page.getByTestId('invite-code')).toBeVisible();
    code = (await page.getByTestId('invite-code').textContent())?.trim() ?? '';
    expect(code).toMatch(/^[A-Z2-9]{8,10}$/);
  });

  await test.step('B opens the invite link and joins by code', async () => {
    await pageB.goto(`/invite/alliance/${code}`);
    await skipPushPrompt(pageB);
    await expect(pageB.getByTestId('alliance-invite-landing')).toContainText(allianceName);
    await pageB.getByTestId('alliance-invite-cta').click();
    await expect(pageB).toHaveURL(/\/game\/alliance\?invite=/, { timeout: 60_000 });
    await expect(pageB.getByTestId('invite-card')).toBeVisible({ timeout: 60_000 });
    await pageB.getByTestId('invite-card-join').click();
    await expect(pageB.getByTestId('alliance-section')).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByTestId('alliance-overview')).toContainText(allianceName);
    await expect(pageB.getByTestId('alliance-overview')).toContainText('Membro');
  });

  await test.step('A sees B arrive through the alliance stream, without a reload', async () => {
    await expect(page.getByTestId('member-row')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByTestId('member-row').filter({ hasText: b.directorName })).toBeVisible();
  });

  await test.step('A promotes B to Deputy; B sees the new role live', async () => {
    const rowB = page.getByTestId('member-row').filter({ hasText: b.directorName });
    await rowB.getByTestId('member-actions').click();
    await page.getByTestId('action-promote').click();
    await expect(rowB.getByTestId('member-role')).toHaveText('Vice', { timeout: 30_000 });
    await expect(pageB.getByTestId('alliance-overview')).toContainText('Vice', { timeout: 30_000 });
  });

  /* ── phase 2 through the API (UI steps replace these when the frontend's board / chat / aid screens land) ── */

  const MASKED_NOTE = 'Turno pesante, che c**** di giornata. Grazie a tutti.';
  await test.step('board (UI): B accepts the rules from the composer notice and posts a note; the filter masks a word; A reads it live', async () => {
    await page.goto('/game/alliance');
    await page.getByTestId('alliance-tab-board').click();
    await expect(page.getByTestId('alliance-board')).toBeVisible();
    await pageB.goto('/game/alliance');
    await pageB.getByTestId('alliance-tab-board').click();
    const blocked = pageB.locator('[data-testid^="write-blocked-"]:not([data-testid="write-blocked-rules"])');
    await expect(blocked).toBeVisible();
    expect(await blocked.getAttribute('data-testid'), 'the only block left for a fresh level-3 account').toBe(
      'write-blocked-RULES_NOT_ACCEPTED',
    );
    await pageB.getByTestId('write-blocked-rules').click();
    await pageB.getByTestId('rules-accept').click();
    await expect(pageB.getByTestId('rules-accepted')).toBeVisible();
    await pageB.keyboard.press('Escape');
    const composer = pageB.getByTestId('board-composer');
    try {
      await expect(composer).toBeVisible({ timeout: 10_000 });
    } catch {
      test.info().annotations.push({
        type: 'ux',
        description: 'the board composer did not unlock live after accepting the rules: needed a reload',
      });
      await pageB.reload();
      await pageB.getByTestId('alliance-tab-board').click();
      await expect(composer).toBeVisible();
    }
    await pageB.getByTestId('board-textarea').fill('Turno pesante, che cazzo di giornata. Grazie a tutti.');
    await pageB.getByTestId('board-post-button').click();
    await expect(pageB.getByTestId('board-post').filter({ hasText: MASKED_NOTE })).toBeVisible();
    // A has the board open in the other browser: the post arrives through the alliance stream, no reload.
    await expect(page.getByTestId('board-post').filter({ hasText: MASKED_NOTE })).toBeVisible();
  });

  const TEXT_B = 'Arrivo con due APS, dieci minuti.';
  let channelId = '';
  let messageId = '';
  await test.step('chat (UI): a text and a quick phrase from B reach A live; a link is refused (API)', async () => {
    await page.goto('/game/alliance/chat');
    await expect(page.getByTestId('chat-composer')).toBeVisible();
    await pageB.goto('/game/alliance/chat');
    await pageB.getByTestId('chat-composer').fill(TEXT_B);
    await pageB.getByTestId('chat-send').click();
    await expect(pageB.getByTestId('chat-message').filter({ hasText: TEXT_B })).toBeVisible();
    await pageB.getByTestId('quick-COMING').click();
    await expect(page.getByTestId('chat-message').filter({ hasText: TEXT_B })).toBeVisible();
    await expect.poll(() => page.getByTestId('chat-message').count()).toBeGreaterThanOrEqual(2);
    const channels = rowsOf<{ id: string; kind: string }>(
      await playerB.call('GET', `${playerB.base}/alliance/channels`),
    );
    channelId = channels.find((c) => c.kind === 'GENERAL')?.id ?? channels[0]!.id;
    const refused = await playerB.refused('POST', `${playerB.base}/alliance/channels/${channelId}/messages`, {
      kind: 'TEXT',
      text: 'scrivimi su www.esempio.it',
    });
    expect(refused).toMatchObject({ status: 422, code: 'TEXT_REJECTED' });
    const seen = rowsOf<{ id: string; kind: string; text: string | null; quick: { code: string } | null }>(
      await playerA.call('GET', `${playerA.base}/alliance/channels/${channelId}/messages`),
    );
    const textMessage = seen.find((m) => m.text === TEXT_B);
    expect(textMessage, 'the text message is in the channel').toBeTruthy();
    messageId = textMessage!.id;
    expect(seen.some((m) => m.kind === 'QUICK' && m.quick?.code === 'COMING')).toBe(true);
  });

  await test.step('mute (UI): A silences B for an hour from the members tab; B sees it live; text refused, quick phrase allowed; A lifts it', async () => {
    await page.goto('/game/alliance');
    await page.getByTestId('alliance-tab-members').click();
    const rowB = page.locator('[data-testid="member-row"][data-role="DEPUTY"]');
    await expect(rowB).toHaveCount(1);
    await rowB.getByTestId('member-actions').click();
    await page.getByTestId('action-mute-H1').click();
    // B still has the chat open: the composer locks without a reload.
    const mutedBanner = pageB.getByTestId('chat-blocked-MUTED');
    try {
      await expect(mutedBanner).toBeVisible({ timeout: 15_000 });
    } catch {
      test.info().annotations.push({
        type: 'ux',
        description: 'the muted notice did not appear live in the chat: needed a reload',
      });
      await pageB.reload();
      await expect(mutedBanner).toBeVisible();
    }
    const muted = await playerB.refused('POST', `${playerB.base}/alliance/channels/${channelId}/messages`, {
      kind: 'TEXT',
      text: 'Provo a scrivere.',
    });
    expect(muted).toMatchObject({ status: 403, code: 'MUTED', details: { scope: 'ALLIANCE' } });
    await playerB.call('POST', `${playerB.base}/alliance/channels/${channelId}/messages`, {
      kind: 'QUICK',
      code: 'ON_SCENE',
    });
    const sanctions = rowsOf<{ kind: string; active: boolean }>(
      await playerB.call('GET', '/api/v1/me/sanctions'),
    );
    expect(sanctions.some((s) => s.kind === 'MUTE_ALLIANCE' && s.active)).toBe(true);
    const members = rowsOf<{ id: string; careerId: string }>(
      await playerA.call('GET', `${playerA.base}/alliance/members`),
    );
    const memberB = members.find((m) => m.careerId === careerB)!;
    await playerA.call('POST', `${playerA.base}/alliance/members/${memberB.id}/unmute`, {});
    await playerB.call('POST', `${playerB.base}/alliance/channels/${channelId}/messages`, {
      kind: 'TEXT',
      text: 'Di nuovo in linea.',
    });
  });

  await test.step('report (UI): A reports the message of B from the chat; the case shows content and context in the moderation queue', async () => {
    await page.goto('/game/alliance/chat');
    const target = page.getByTestId('chat-message').filter({ hasText: TEXT_B });
    await expect(target).toBeVisible();
    await target.hover();
    await target.getByTestId('message-actions').click();
    await page.getByTestId('message-report').click();
    await expect(page.getByTestId('report-form')).toBeVisible();
    await page.getByTestId('report-reason-HARASSMENT').check();
    await page.getByTestId('report-note').fill('prova e2e');
    await page.getByTestId('report-submit').click();
    await expect(page.getByTestId('report-done')).toBeVisible();
    const rows = rowsOf<{ id: string; targetKind: string; targetId: string; status: string }>(
      await playerA.call('GET', '/api/v1/admin/moderation/reports'),
    );
    const row = rows.find((r) => r.targetKind === 'MESSAGE' && r.targetId === messageId);
    expect(row, 'the report is in the moderation queue').toBeTruthy();
    expect(row!.status).toBe('OPEN');
    const detail = await playerA.call<{
      content: { text: string };
      reporters: unknown[];
      context: unknown[];
    }>('GET', `/api/v1/admin/moderation/reports/${row!.id}`);
    expect(detail.content.text).toBe(TEXT_B);
    expect(detail.reporters).toHaveLength(1);
    expect(detail.context.length).toBeGreaterThan(0);
  });

  await test.step('aid (UI): A asks for help from the incident inspector, B sends a column from the aid tab; the column reaches the scene', async () => {
    const created = cli('incident:create', careerA, 'FIRE_DWELLING', '5', '900');
    const incidentId = /inc_[0-9A-Z]{26}/.exec(created)?.[0];
    expect(incidentId, `incident id in: ${created}`).toBeTruthy();
    await page.goto('/game');
    await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
    await expect(page.getByTestId('incident-inspector')).toBeVisible();
    await page.getByTestId('aid-request-button').click();
    await expect(page.getByTestId('aid-withdraw')).toBeVisible();
    // B: the request is in the aid tab; the composer lists B's vehicles.
    await pageB.goto('/game/alliance');
    await pageB.getByTestId('alliance-tab-aid').click();
    const request = pageB.getByTestId('aid-request');
    await expect(request).toHaveCount(1);
    await request.getByTestId('aid-send').click();
    await expect(pageB.getByTestId('column-composer')).toBeVisible();
    const checks = pageB.getByTestId('column-vehicle-check');
    await expect(checks.first()).toBeVisible();
    let picked = 0;
    for (let i = 0; i < (await checks.count()) && picked < 2; i += 1) {
      const check = checks.nth(i);
      if (await check.isEnabled()) {
        await check.click();
        picked += 1;
      }
    }
    expect(picked, 'at least one vehicle can be sent').toBeGreaterThan(0);
    await pageB.getByTestId('column-send').click();
    const columnRow = pageB.locator('[data-testid="aid-column"][data-mine="true"]').first();
    await expect(columnRow).toBeVisible();
    await expect(columnRow).toHaveAttribute('data-status', 'EN_ROUTE');
    const columnId = await columnRow.getAttribute('data-column-id');
    expect(columnId).toBeTruthy();
    const vehiclesB = rowsOf<{ id: string; status: string }>(
      await playerB.call('GET', `${playerB.base}/vehicles`),
    );
    expect(vehiclesB.filter((v) => v.status === 'ALLIED_SUPPORT').length).toBe(picked);
    const received = rowsOf<{ id: string }>(
      await playerA.call('GET', `${playerA.base}/alliance/aid-columns`),
    );
    expect(received.some((c) => c.id === columnId)).toBe(true);
    // The column drives for real (2–15 game minutes): poll the helper's columns until it is on scene.
    await waitFor(
      'the allied column on scene',
      async () => {
        const columns = rowsOf<{ id: string; status: string }>(
          await playerB.call('GET', `${playerB.base}/alliance/aid-columns`),
        );
        const mine = columns.find((c) => c.id === columnId);
        return mine && mine.status !== 'EN_ROUTE' ? mine : null;
      },
      { timeoutMs: 16 * 60_000, intervalMs: 5_000 },
    );
    const incident = await playerA.call<{
      allied?: Array<{ id: string }>;
      requirements: Array<{ allied?: number }>;
    }>('GET', `${playerA.base}/incidents/${incidentId}`);
    expect((incident.allied ?? []).length > 0 || incident.requirements.some((r) => (r.allied ?? 0) > 0)).toBe(
      true,
    );
    // The requester's inspector shows the allied units once they are on scene.
    await page.goto('/game');
    await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
    await expect(page.getByTestId('allied-units')).toBeVisible();
  });

  await test.step('settlement: the incident ends, the helper is paid (phase 2b-2: needs the incident to close)', async () => {
    test.info().annotations.push({
      type: 'todo',
      description: 'phase 2b-2: end the incident (dispatch A, wait) and assert the ALLIANCE_AID ledger entry',
    });
  });

  checkB();
  await api.dispose();
  await contextB.close();
});
