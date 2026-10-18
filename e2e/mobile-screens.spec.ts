import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootCareer, isMobile, qa, trackProblems } from './helpers';

/**
 * Every player screen on a phone (agent `mobile`, 2026-10-18): at 360, the project's own width (Pixel 7 412 px,
 * iPhone 14 390 px) and 430 px, each screen must
 *  - never scroll sideways (`scrollWidth <= innerWidth`, on the document and on the page's own vertical scroller), and
 *    keep every visible element inside the screen: the game shell clips its overflow, so a row wider than the phone does
 *    not scroll — it is silently cut (the site list of "Nuova sede" and the specialist candidates were);
 *  - show its main action in view and clickable (Playwright's trial click: visible, enabled, not covered by the bottom
 *    bar or a toast).
 * Phone-only (the `mobile` and `iphone` projects); the desktop layout has its own specs.
 */
trackProblems();

const WIDTHS = [
  { width: 360, height: 740 },
  null, // the project's own device
  { width: 430, height: 932 },
];

/** Horizontal overflow, and the visible elements that reach past the right/left edge outside a sideways scroller. */
async function overflow(page: Page): Promise<{ doc: number; scroller: number; outside: string[] }> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    /**
     * Inside a sideways scroller (a chip row: meant to scroll), or a deliberate clip that itself fits the screen (an
     * ellipsis box): the overflow is not lost content. The page frames (`.scroll-y`, the shell) do not count.
     */
    const contained = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (p.classList.contains('scroll-y') || p.hasAttribute('data-sheet-scroll') || p.tagName === 'MAIN')
          continue;
        if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true;
        const pr = p.getBoundingClientRect();
        if ((s.overflowX === 'hidden' || s.overflowX === 'clip') && pr.right <= vw + 1 && pr.left >= -1)
          return true;
      }
      return false;
    };
    const outside: string[] = [];
    for (const el of Array.from(document.querySelectorAll('main *, [role="dialog"] *'))) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || (r.right <= vw + 1 && r.left >= -1)) continue;
      const s = getComputedStyle(el);
      if (s.position === 'fixed' || s.visibility === 'hidden') continue;
      if (el.closest('[aria-hidden="true"],[inert],.sr-only,.maplibregl-map')) continue;
      if (contained(el)) continue;
      const pr = el.parentElement?.getBoundingClientRect();
      if (pr && (pr.right > vw + 1 || pr.left < -1)) continue; // report the outermost offender only
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      outside.push(`${el.tagName.toLowerCase()} "${text}" ${Math.round(r.left)}→${Math.round(r.right)}`);
    }
    const scrollers = Array.from(document.querySelectorAll<HTMLElement>('main .scroll-y'));
    return {
      doc: document.documentElement.scrollWidth - vw,
      scroller: Math.max(0, ...scrollers.map((s) => s.scrollWidth - s.clientWidth)),
      outside,
    };
  });
}

async function expectFitsAndActs(page: Page, label: string, action: Locator): Promise<void> {
  await expect(action, `${label}: main action`).toBeVisible();
  await action.scrollIntoViewIfNeeded();
  // Trial click: actionable and not covered (bottom bar, toast, sticky footer) — nothing is triggered. A disabled action
  // (e.g. "Assumi" with no free bed) must still be fully on screen.
  if (await action.isEnabled()) await action.click({ trial: true });
  else await expect(action, `${label}: main action`).toBeInViewport({ ratio: 1 });
  const o = await overflow(page);
  expect(o.doc, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
  expect(o.scroller, `${label}: the page's scroller is wider than the phone`).toBeLessThanOrEqual(1);
  expect(o.outside, `${label}: elements past the screen edge`).toEqual([]);
}

interface Screen {
  name: string;
  open: (page: Page) => Promise<void>;
  action: (page: Page) => Locator;
}

const visit = (url: string) => async (page: Page) => {
  await page.goto(url);
  await expect(page.getByTestId('topbar')).toBeVisible();
};

/** A fresh call on the map (the world is quiet and off duty: nothing else arrives, nothing is left over to expire). */
const withCall = (url: string) => async (page: Page) => {
  await visit('/game')(page);
  await qa(page, 'spawn', 'ROAD_ACCIDENT_TRAPPED', 4);
  // (/game/incidents opens the map with the list on a phone: a client-side redirect, hence /game first.) Reloaded from the saved mock state: on WebKit the live event of a call spawned right after the load can be missed.
  await visit(url)(page);
  await expect(page.getByTestId('incident-card').first()).toBeVisible();
};

const GAME_SCREENS: Screen[] = [
  { name: 'map', open: withCall('/game'), action: (p) => p.getByTestId('incident-card').first() },
  {
    name: 'incidents',
    open: withCall('/game/incidents'),
    action: (p) => p.getByTestId('incident-card').first(),
  },
  {
    name: 'incident detail',
    open: async (page) => {
      await withCall('/game')(page);
      await page.getByTestId('incident-card').first().click();
      await expect(page.getByTestId('incident-inspector')).toBeVisible();
    },
    action: (p) => p.getByTestId('send-recommended'),
  },
  {
    name: 'fleet',
    open: visit('/game/fleet'),
    action: (p) => p.getByTestId('vehicle-card').first(),
  },
  {
    name: 'vehicle sheet',
    open: async (page) => {
      await visit('/game/fleet')(page);
      await page.getByTestId('vehicle-card').first().click();
      await expect(page.getByTestId('vehicle-inspector')).toBeVisible();
    },
    action: (p) => p.getByTestId('inspector-close'),
  },
  {
    name: 'facilities',
    open: visit('/game/facilities'),
    action: (p) => p.getByTestId('new-facility-jump'),
  },
  {
    name: 'new facility sites',
    open: async (page) => {
      await visit('/game/facilities')(page);
      await page.getByTestId('new-facility-jump').click();
      await expect(page.getByTestId('site-row').first()).toBeVisible();
    },
    action: (p) => p.getByTestId('site-row').first(),
  },
  {
    name: 'personnel',
    open: visit('/game/personnel'),
    action: (p) => p.getByTestId('operator-card').first(),
  },
  {
    name: 'personnel teams',
    open: async (page) => {
      await visit('/game/personnel?tab=teams')(page);
    },
    action: (p) => p.getByTestId('form-team').first(),
  },
  {
    name: 'personnel recruitment',
    open: async (page) => {
      await visit('/game/personnel?tab=recruitment')(page);
      await expect(page.getByTestId('candidate-card').first()).toBeVisible();
    },
    action: (p) => p.getByTestId('hire-candidate').first(),
  },
  {
    name: 'personnel training',
    open: visit('/game/personnel?tab=training'),
    action: (p) => p.getByTestId('course-card').first(),
  },
  { name: 'logistics', open: visit('/game/logistics'), action: (p) => p.getByTestId('open-order').first() },
  {
    name: 'stock order',
    open: async (page) => {
      await visit('/game/logistics')(page);
      await page.getByTestId('open-order').first().click();
      await expect(page.getByTestId('order-dialog')).toBeVisible();
    },
    // The dialog's action stays in view on a phone (sticky footer), without scrolling the sheet.
    action: (p) => p.getByTestId('order-submit'),
  },
  {
    name: 'economy',
    open: visit('/game/economy'),
    action: (p) => p.getByRole('heading', { level: 1 }),
  },
  {
    name: 'progression',
    open: visit('/game/progression'),
    action: (p) => p.getByTestId('unlock-level').last(),
  },
  // Every garage may be full by now ("Ampia o promuovi una sede" instead of the buy button): the offer card itself.
  { name: 'shop', open: visit('/game/shop'), action: (p) => p.getByTestId('vehicle-offer').first() },
  { name: 'credits', open: visit('/game/credits'), action: (p) => p.getByTestId('buy-package').first() },
  {
    name: 'credits cancel',
    open: visit('/game/credits/cancel'),
    action: (p) => p.getByRole('link', { name: 'Torna ai pacchetti' }),
  },
  { name: 'network', open: visit('/game/network'), action: (p) => p.getByTestId('share-invite') },
  { name: 'alliance', open: visit('/game/alliance'), action: (p) => p.getByTestId('alliance-tab-chat') },
  {
    name: 'alliance members',
    open: async (page) => {
      await visit('/game/alliance')(page);
      await page.getByTestId('alliance-tab-members').click();
    },
    action: (p) => p.getByTestId('member-actions').first(),
  },
  {
    name: 'alliance chat',
    open: async (page) => {
      await page.goto('/game/alliance/chat');
      await expect(page.getByTestId('chat-composer')).toBeVisible();
    },
    action: (p) => p.getByTestId('chat-composer'),
  },
  {
    name: 'alliance operation',
    open: async (page) => {
      await page.goto('/game/alliance/operation');
      await expect(page.getByTestId('operation-back')).toBeVisible();
    },
    action: (p) => p.getByTestId('operation-back'),
  },
  { name: 'settings', open: visit('/game/settings'), action: (p) => p.getByTestId('logout') },
  { name: 'more', open: visit('/game/more'), action: (p) => p.getByRole('link', { name: 'Impostazioni' }) },
];

async function setViewport(
  page: Page,
  size: { width: number; height: number } | null,
  base: Page['viewportSize'],
) {
  const target = size ?? base();
  if (target) await page.setViewportSize(target);
}

/** A level-30 career with every section filled: monetization open, a second service, an alliance with a member. */
async function richCareer(page: Page, project: string): Promise<void> {
  // Real-time clock (×1): a call on screen does not expire while the screens are visited.
  await bootCareer(page, project, { level: 30, credits: 900_000, speed: 1 });
  // The first organic purchase opens Ricarica Crediti and La tua rete.
  await page.goto('/game/shop');
  await page
    .locator('[data-testid="vehicle-offer"][data-code="FIRE_APS"]')
    .getByTestId('buy-vehicle')
    .click();
  await expect(page.getByTestId('toast').filter({ hasText: 'APS 2 ordinato' })).toBeVisible();
  await qa(page, 'addVehicles', 'EMS_MSB', 2);
  await qa(page, 'staffAll');
  const suffix = `${Date.now()}`.slice(-2);
  const alliance = await qa<{ id: string }>(page, 'foundAlliance', {
    name: `Abruzzo Soccorso ${suffix}`,
    tag: `AB${suffix}`,
  });
  const marta = await qa<{ careerId: string }>(page, 'simulateAlly', 'Marta', {
    level: 6,
    city: 'Chieti',
    onDuty: true,
  });
  await qa(page, 'allyRequestJoin', marta.careerId, alliance.id);
  await qa(page, 'enableWriting');
  // A quiet world (off duty, no random calls or their toasts over the actions); each map screen spawns its own call.
  await qa(page, 'quiet');
}

// One test per width: three independent careers, run in parallel.
for (const size of WIDTHS) {
  test(`every game screen fits the phone and keeps its main action in reach @ ${size ? `${size.width}px` : 'device'}`, async ({
    page,
  }, info) => {
    test.skip(!isMobile(page), 'phone layouts only');
    test.setTimeout(300_000);
    if (size) await page.setViewportSize(size);
    const w = page.viewportSize()?.width;
    await richCareer(page, info.project.name);
    for (const screen of GAME_SCREENS) {
      await test.step(`${screen.name} @ ${w}px`, async () => {
        await screen.open(page);
        await expectFitsAndActs(page, `${screen.name} @ ${w}px`, screen.action(page));
      });
    }
  });
}

test('sign-in, invitations and the offline page fit the phone', async ({ page }) => {
  test.skip(!isMobile(page), 'phone layouts only');
  const own = page.viewportSize();
  for (const size of WIDTHS) {
    await setViewport(page, size, () => own);
    const w = size?.width ?? own?.width;
    await test.step(`auth @ ${w}px`, async () => {
      await page.goto('/auth');
      await expectFitsAndActs(page, `auth @ ${w}px`, page.getByRole('button', { name: 'Inviami il codice' }));
    });
    await test.step(`invite @ ${w}px`, async () => {
      await page.goto('/invite/ZZZZ9999');
      await expectFitsAndActs(page, `invite @ ${w}px`, page.getByTestId('invite-cta'));
    });
    await test.step(`alliance invite @ ${w}px`, async () => {
      await page.goto('/invite/alliance/ZZZZ9999');
      await expectFitsAndActs(page, `alliance invite @ ${w}px`, page.getByTestId('alliance-invite-cta'));
    });
    await test.step(`offline @ ${w}px`, async () => {
      await page.goto('/offline');
      await expectFitsAndActs(page, `offline @ ${w}px`, page.getByRole('button', { name: 'Riprova' }));
    });
  }
});
