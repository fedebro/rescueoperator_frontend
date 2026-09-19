# Rescue Control — frontend

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind 4 · Radix (shadcn-style components) · TanStack Query ·
Zustand · React Hook Form + Zod · next-intl (it/en/fr/de/es) · MapLibre GL + PMTiles · socket.io-client.
One app: the game (`/auth`, `/onboarding`, `/game/*`), the admin shell (`/admin/*`) and the living style guide (`/design`).

## Run

```bash
pnpm install
cp .env.example .env.local
pnpm dev:mock        # http://localhost:3000 — standalone, in-browser mock backend (OTP is always 123456)
pnpm dev             # against the real API at NEXT_PUBLIC_API_URL (default http://localhost:4000); OTP arrives in Mailpit
```

| Script                                               | What                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck` · `pnpm lint` · `pnpm format:check` | static checks                                                                                                                              |
| `pnpm test`                                          | Vitest + Testing Library (formatters, clock, geo, reconciliation, realtime controller, API client, mock engine, components, message files) |
| `pnpm e2e`                                           | Playwright, desktop Chromium + Pixel 7 viewport, production build on :3210 wired to the mock (time ×12)                                    |
| `pnpm check:i18n`                                    | key + ICU-argument parity of the five locales and every static `t('…')` in the source                                                      |
| `pnpm sync:contracts`                                | re-copies `../rescue-control-backend/contracts/src` → `src/contracts` (**never edit the copy**)                                            |
| `pnpm gen:assets`                                    | regenerates logos, favicon, PWA icons, OG image and `public/icons/**` from code                                                            |

## Mock backend (`NEXT_PUBLIC_API_MOCK=1`)

`src/mocks`: MSW intercepts the v1 REST API; `engine.ts` simulates the server core loop with the same design as the
backend (scheduled actions with due times, anchored work model, append-only ledger, idempotent commands, `seq`-numbered
realtime envelopes). State persists in `localStorage` (`rc-mock-db-v3`) and catches up after a reload. Realtime uses an
in-page bus instead of Socket.IO. `NEXT_PUBLIC_MOCK_SPEED` (or `localStorage['rc-mock-speed']`) compresses time.
Sign in as `admin@rescue-control.test` to get the admin role. `window.__rcMock.reset()` wipes the mock world.

## Map

Custom dark style built in code (`src/features/map/style.ts`). Default source: OpenFreeMap public vector tiles
(OpenMapTiles schema, keyless — development only). Production / self-hosted: set `NEXT_PUBLIC_PMTILES_URL`
(+ `NEXT_PUBLIC_PMTILES_SCHEMA`, glyph URL and font stacks — see `.env.example`, which includes the values for the local
tile server at `127.0.0.1:8088`). The OpenStreetMap attribution control is always expanded.
Game entities are GeoJSON sources on WebGL layers; marker images are generated at runtime from the icon set.

## Layout (D-12)

`useIsDesktop()` (≥1024px) switches between the two first-class layouts over the same stores and components:
desktop = top bar · icon sidebar · incident queue · map · inspector · dense virtualized tables;
mobile = fullscreen map · 5-item bottom nav · three-height bottom sheet · card lists · safe-area insets.

## Where things live

`src/contracts` wire contract (copy) · `src/lib/api` client, endpoints, assumed shapes · `src/lib/realtime` reconcile +
controller + transports · `src/stores` Zustand · `src/components/ui` design system · `src/design/icons` icon set ·
`src/features/*` screens · `src/messages` translations · `src/mocks` mock backend · `e2e` Playwright.
