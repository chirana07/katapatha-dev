# Work breakdown — 5 days, 9 people

**Deadline:** Day 5. **Definition of done:** a demo-able happy path — one
complete end-to-end flow per role, on seeded data, deployed, plus an installable
Android APK. Not feature-complete. Not production-hardened.

**Why 5 days is realistic:** about 5,000 lines of tested business logic came
across from the previous application unchanged, and its service layer already
had the shape an API handler needs — `(args, actor)`. The week's work is putting
a contract in front of working code, not writing the logic again.

---

## Who owns what

One owner per directory, enforced by `.github/CODEOWNERS`. Two people should
never need to edit the same directory this week.

| Who | Owns | Away 2 days |
|---|---|---|
| **LEAD** | scaffold, `packages/contracts`, `packages/tokens`, Prisma schema, CI, docs, all review, deploy | no |
| **BE1** | `api/src/lib/` (auth, authz, audit), `routes/{system,auth,reference}.ts`, **all migrations**, seed | no — critical path |
| **BE2** | `routes/{orders,planning}.ts`, `services/` (except delivery), `schema/planning.prisma` | **yes** |
| **BE3** | `routes/{trips,driver,stops,sync}.ts`, `services/delivery.ts`, `schema/{execution,ledger}.prisma` | no — owns the new sync work |
| **WEB1** | `web/src/app/dispatcher/`, the app shell, sign-in | no — critical path |
| **WEB2** | `web/src/app/store/`, `packages/api-client` | **yes** |
| **WEB3** | `web/src/app/loader/` (tablet), `web/src/app/driver/` (mobile web + PWA) | no |
| **MOB1** | `mobile/src/{api,outbox}`, `mobile/app/` — shell, auth, **offline outbox** | no — hardest new work |
| **MOB2** | `mobile/src/screens/` — run list, stop detail, POD, problems | **yes** |

### Why the absences land where they do

Each team's absentee owns the **most bounded, best-specified** slice and sits
off the critical path.

- **BE2** (orders and planning) is the most tightly specified backend work: the
  services already exist and the contract is frozen, so it picks up cleanly
  after two days away.
- **WEB2** (store console) is the smallest surface with no downstream
  dependents, and the existing pages are being rewired rather than designed.
- **MOB2** is deliberate sequencing, not convenience. MOB1 builds the shell and
  the outbox — the hard, critical path — alone and uninterrupted, and MOB2
  returns to well-specified screens that go quickly once the shell exists. The
  reverse would leave one person alone on the offline engine *and* the screens.

---

## The demo spine — never cut

Twelve operations, four roles. Every one of them already exists as working code
in the previous application. If something has to give, it is never one of these.

```
STORE       sign in -> place order
DISPATCHER  close queue -> auto-plan -> confirm deferrals with reasons -> publish
LOADER      check every line -> resolve/raise shortfall -> mark ready
DRIVER      choose vehicle -> arrive -> unload -> complete with POD
STORE       confirm receipt
```

---

## Day 1 — contract freeze

**LEAD does nothing else today.** If the contract and the mock are not up, eight
people are idle tomorrow. That is the single biggest risk in the plan.

| Who | Work |
|---|---|
| **LEAD** | Already done in scaffolding: monorepo, the four shared packages with tests green, split Prisma schema, seed working, OpenAPI v1 + Prism mock, generated client, CI, tokens, these docs. Today: **freeze the contract**, verify CI on a real PR, hand out starter issues. |
| **BE1** | Harden `routes/auth.ts`, then `routes/reference.ts` (outlets, vehicles, vocabularies, next-operating-day). Unblocks everyone. |
| **BE2** | Read `services/{plans,store}.ts`. Replace the `orders` stub with real `GET /orders` and `POST /orders` (idempotent on `requestId`). |
| **BE3** | Design the shared stop-event applier **on paper**, reviewed by BE1 and LEAD before any code. Then `GET /trips` and `GET /trips/{id}/load-list`. |
| **WEB1** | App shell, rail, sign-in against the real API. |
| **WEB2** | Prove `packages/api-client` against the mock; start the store console. |
| **WEB3** | Loader tablet against the mock, 44px targets. |
| **MOB1** | Expo shell, sign-in, token in SecureStore, outbox storage schema. |
| **MOB2** | Run list and stop detail against the mock. |

**Gate, end of day:** contract frozen; every developer has made one commit that
passes CI.

## Day 2 — reads real, writes still mocked
- **BE1** auth and reference complete and tested · **BE2** orders + store reads ·
  **BE3** the applier + `POST /stops/{id}/events` (online path)
- **WEB1** dispatcher plan board on the real API · **WEB2** store console ·
  **WEB3** loader
- **MOB1 + MOB2 pair all day on the outbox** — this is the insurance against
  MOB2's absence

**Gate:** a dispatcher sees a real plan from the real allocator through the real API.

## Day 3 — all mutations real
- **BE1** `/planning-days/{id}/closure`, `POST /plans`, `/plans/{id}/validation` ·
  **BE2** publish with `violations[]`, deferrals, receipts ·
  **BE3** load checks, readiness with real 409s, **`POST /sync/stop-events`**
- Web cuts every screen over from the mock
- **MOB1** outbox drain verified by killing the network mid-run

**Gate:** every mutation on the demo spine works against the real API.

## Day 4 — integration only, no new features
Feature freeze at midday. All three apps on the real API. One Playwright spec
per role at its real viewport. The offline outbox is **verified** — or the
offline claim comes out of the UI, which `PRODUCT.md` requires.

## Day 5 — ship
Deploy to the VPS with Compose. One EAS APK. Seed the demo database. Two timed
rehearsals, one per role. Record a video fallback in case live networking fails.
Code freeze mid-afternoon.

---

## Cut list, in order

Cut from the top when behind:

1. Dispatcher `fuel` and `outlets` views, `RouteMap` + Leaflet — maps are the
   worst cost-to-value ratio on the board
2. The `/exceptions` inbox
3. Notifications feed, store history and issue pages
4. **The native app.** The driver mobile web in `apps/web` already covers the
   DRIVER role — which is exactly why it was specified that way. Cutting this
   frees both mobile developers to reinforce web.
5. **Offline durability.** Keep the endpoint (it is ~40 lines once the applier
   exists, and it is the strongest architectural story), demo online-only, and
   label connectivity honestly.

---

## Two standing rules

**Ask LEAD before adding a dependency.** All of them were installed during
scaffolding. `pnpm-lock.yaml` conflicts are resolved by regenerating, never by
hand — and CI runs `--frozen-lockfile`, so a hand-edited lockfile fails there.

**Ask BE1 before changing the database.** BE1 is the sole migration author for
the week. Everyone else uses `prisma db push` against their own local database.
Two migration windows: Day 1 late afternoon and Day 3 midday.
