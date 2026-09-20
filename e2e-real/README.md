# Real-backend end-to-end suite

`e2e/` runs against the in-browser MSW mock (that is what CI runs on every push, and it must stay green).
**This** suite runs the same product against the real thing: the Express API, MariaDB, Redis, OSRM and Mailpit.
It is the only automated proof that the two halves of the project actually fit together.

## What it needs

The shared local services, from the repository root:

```bash
docker compose -f infra/docker-compose.yml up -d mariadb redis mailpit osrm
# optional but recommended: the local basemap the suite points at
docker compose -f infra/tiles/docker-compose.yml up -d
```

Nothing else. The suite creates and destroys its own database.

## Running it

```bash
cd rescue-control-frontend
pnpm e2e:real                      # both projects (real-desktop, real-mobile)
pnpm e2e:real --project=real-desktop
pnpm e2e:real e2e-real/medical.spec.ts
pnpm e2e:real --headed --workers=1 # watch it play
```

The first run builds the client (a couple of minutes); later runs reuse `.next-real`.
`pnpm e2e:real:report` opens the HTML report.

## What happens on every run

1. Starting the API also **resets the world**: its command is `pnpm reset:db && tsx src/entrypoints/all.ts`, and it
   never reuses a running server. `scripts/reset-db.mjs` drops and recreates `rescue_control_test_e2e`, applies the
   migrations, seeds it, imports the Abruzzo geodata release and flushes the Redis logical database so no delayed job
   survives from a previous run. It refuses to touch anything that is not a local `rescue_control*` database, and it
   never flushes Redis logical db 0 (the developer's own). The reset lives in the server command rather than in
   `globalSetup` because Playwright starts `webServer` first.
2. Playwright starts **two servers**: the API (port 4100) and the client (`next build && next start`, port 3211,
   `NEXT_PUBLIC_API_MOCK=0`, output in `.next-real`).
3. The specs play the product.

Everything is isolated from a running dev stack: different database, different Redis logical db, different BullMQ
prefix, different ports, different Next output directory. A `pnpm dev` on 3000/4000 can stay up.

## What the suite covers

| Spec                    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `critical-path.spec.ts` | sign-up with a one-time code **read from Mailpit** → onboarding on the real geodata (Pescara, three real starter sites) → the scripted first mission → dispatch → the vehicle driving an OSRM route → arrival → resolution → the outcome and the reward arriving over the socket → buying a second vehicle → delivery → **reload: the session is restored from the refresh cookie, the socket reconnects and the state is intact** → the second service family unlocking → the ledger |
| `medical.spec.ts`       | acquiring an **EMS site from the real candidate sites** → buying an ambulance → hiring and onboarding a crew → a generated medical call → patient assessment and on-scene treatment → **hand-over to a hospital imported from the geodata release**                                                                                                                                                                                                                                   |
| `admin.spec.ts`         | a staff account signing in to `/admin`, the dashboard reporting the real providers, the career inspector, a **credit adjustment with a reason** → the audit row → **the player's open tab showing the new balance over the socket**, and the movement in their own ledger                                                                                                                                                                                                             |

Both projects (`real-desktop` 1440×900, `real-mobile` Pixel 7) run every spec.

## Rules the suite follows

- **No fixed sleeps.** The only timing primitive is `waitFor` in `helpers.ts`, which polls with an explicit budget;
  everything else is Playwright's auto-retrying `expect`. A slow machine makes a run slower, never flaky.
- **Managerial timers are compressed with the real speed-up feature**, not with a faked clock — the server still runs
  the normal completion handler, so what the test observes is what a player observes.
- **Privileged shortcuts go through the documented support tooling** (`pnpm cli career:grant`, `grant-role`,
  `incident:create`). Everything a player can do is done through the UI.
- **Every test fails on a 5xx**, a page error, a missing translation or a contract mismatch (`trackProblems`).

## Troubleshooting

- _`database reset failed`_ — the infra services are not up (see above).
- _The build step takes minutes on the first run_ — expected; `.next-real` is reused afterwards.
- _Mailpit has thousands of old messages_ — the OTP lookup filters by recipient and by timestamp, so it is safe, but
  `curl -X DELETE http://127.0.0.1:8025/api/v1/messages` keeps the UI usable.
- _A run left the database behind_ — that is deliberate: `rescue_control_test_e2e` is kept so a failure can be inspected.
  The next run drops it.
