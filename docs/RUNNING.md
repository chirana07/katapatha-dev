# Running Katapatha locally

Three apps over one database: `apps/api` (Fastify, :3001), `apps/web` (Next.js,
:3000) and `apps/mobile` (Expo, Metro on :8081).

[README.md](../README.md) has the short version. This is the long one — the
ordering that works, and the failures that are easy to spend an hour on.

## Prerequisites

| | Pinned by | Notes |
|---|---|---|
| Node **24** | [.nvmrc](../.nvmrc) | `nvm use`. The mobile tests need `node:sqlite`, which is unflagged from 23.4. |
| pnpm **12.3.4** | `packageManager` in [package.json](../package.json) | `corepack enable` is enough. |
| Docker | — | Postgres 17 only; nothing else is containerised for dev. |

---

## 1. Install

```bash
pnpm install
```

**The first install is slow and may fail part way.** Four Expo packages are
large — `expo-sqlite` (33 MB), `expo-modules-core` (31 MB), `hermes-compiler`
(19 MB), `expo-image-manipulator` (12 MB) — and on a slow connection pnpm
downloads them in parallel until each individually times out:

```
Error: ERR_PNPM_TARBALL_FETCH_TARBALL
  ╰─▶ operation timed out
```

Retry with the downloads serialised and a long timeout:

```bash
pnpm install --config.fetch-timeout=1800000 --config.network-concurrency=1
```

If one tarball keeps failing, fetch it into the store on its own first, then
install normally — the install then resolves it locally in about a second:

```bash
pnpm store add expo-sqlite@57.0.3 --config.fetch-timeout=1800000
pnpm store add expo-modules-core@57.0.20 --config.fetch-timeout=1800000
pnpm install
```

> **Note the `--config.` prefix.** pnpm 12 does **not** read `fetch-timeout`,
> `fetch-retries` or `network-concurrency` from `.npmrc` — `pnpm config get
> fetch-timeout` returns `undefined` even though [.npmrc](../.npmrc) sets it.
> Those settings moved to `pnpm-workspace.yaml` in pnpm 10+, so the comment in
> `.npmrc` about surviving a flaky network no longer has any effect. Pass them
> on the command line.

**Only working on the API and web?** Skip the Expo download entirely:

```bash
pnpm install --filter @katapatha/api... --filter @katapatha/web...
```

The committed lockfile covers all nine workspace projects, so a filtered
install does not change it.

---

## 2. Database

```bash
pnpm db:up                                        # Postgres 17 in Docker
pnpm --filter @katapatha/api exec prisma migrate deploy
pnpm demo:reset --yes                             # schema reset + migrate + seed
```

`pnpm demo:reset` is the one to reach for: it drops the schema, re-applies
migrations and re-seeds to a known state in about ten seconds. It prompts
unless you pass `--yes`, and refuses to run against a `DATABASE_URL` whose
database name contains `prod` (override with `DEMO_RESET_FORCE=1`). Use
`pnpm db:seed` instead if you only want to seed without dropping anything —
it is idempotent and no-ops unless you set `SEED_FORCE=1`.

If `DATABASE_URL` is not in your environment:

```bash
export DATABASE_URL="postgresql://katapatha:katapatha@localhost:5432/katapatha?schema=public"
```

### Seeded accounts

Password is `waypoint` for all four.

| Email | Role | Scope |
|---|---|---|
| `nimal@waypoint.lk` | DISPATCHER | depot Peliyagoda |
| `ranjith@waypoint.lk` | LOADER | depot Peliyagoda |
| `sunil@waypoint.lk` | DRIVER | claims a vehicle at the dock |
| `fathima@waypoint.lk` | STORE_MANAGER | outlet OUT074 |

The loader's dock tablet signs in with a **staff ID and PIN** instead (L-01):
staff ID `LDR-0142`, PIN `4826`. Ranjith's email and password still work too.

For screens with something on them, run `pnpm demo:morning` after a reset. It
leaves the hero day (`?date=2026-04-09`) mid-morning: trips loaded, short, half
counted, a vehicle swapped mid-load (VEH102 trip 2 → VEH104), a warm chiller and
a handover note, with the dock's times placed on the hero day itself.

---

## 3. API and web

```bash
pnpm dev          # api on :3001, web on :3000
```

`pnpm dev` is `turbo run dev`, and **only `apps/api` and `apps/web` have a `dev`
script** — the mobile app is not started by it and needs its own command
(step 4).

- API health: <http://localhost:3001/v1/health>
- Web: <http://localhost:3000>
- **`/access`** — one-click sign-in as any of the four seeded roles, so you do
  not retype credentials all day. Dev-only: it requires `NODE_ENV` to be
  explicitly `development` or `test`, or `ALLOW_DEMO_ACCESS=1`. It posts the
  real seeded password to `/auth/session`; it does not forge a session.

### Verify the whole loop in one command

```bash
pnpm demo:reset --yes && pnpm demo:smoke
```

`demo:smoke` walks the demo spine over HTTP — store places an order,
dispatcher closes the queue, auto-plans, confirms deferrals and publishes,
loader checks the load and marks ready, driver claims a vehicle and arrives,
unloads and delivers with proof of delivery, store confirms receipt. It exits
non-zero on any failure, so it doubles as a regression gate. It expects a
freshly reset database and talks only to the HTTP API, never the DB directly.

> `demo:reset` leaves the planning day **OPEN with no published plan**. Until a
> plan is published, the driver's run is legitimately empty — the app will show
> "Claim a vehicle to start" and then no stops. Run `demo:smoke`, or publish
> through the dispatcher UI, before expecting the driver app to have work.

---

## 4. Mobile app

```bash
pnpm --filter @katapatha/mobile start
```

Open the printed QR in **Expo Go**. Your Expo Go must support **SDK 57** or it
will refuse the bundle.

### On a simulator

Nothing more to do. The default base URL is the real API on `localhost:3001`
(`/v1` prefix), so start the API first. To use the Prism mock instead (paths at
the root, no `/v1`):

```bash
KATAPATHA_API_BASE_URL="http://localhost:4010" pnpm --filter @katapatha/mobile start
```

The app follows the phone's light/dark setting (the night palette is the
driver's only; see `docs/DESIGN.md`). Position sharing is off until the driver
turns it on from the Connection screen, and only reports while the app is open.

### On a real handset — two things are required

A phone cannot reach `localhost`, and by default the API will not accept a LAN
connection either.

```bash
# 1. find this machine's LAN address
ipconfig getifaddr en0                    # e.g. 10.187.0.209

# 2. bind the API to all interfaces (it is localhost-only in dev by default)
DATABASE_URL=... HOST=0.0.0.0 PORT=3001 pnpm --filter @katapatha/api dev

# 3. give the app that address
KATAPATHA_API_BASE_URL="http://10.187.0.209:3001/v1" pnpm --filter @katapatha/mobile start
```

`HOST` is the part people miss. [apps/api/src/main.ts](../apps/api/src/main.ts)
binds `localhost` unless `NODE_ENV=production`, because the dev proxy and
Playwright reach it over IPv6 loopback — so without `HOST=0.0.0.0` the phone
gets a connection refused no matter which base URL the app was given. Confirm it
took effect:

```bash
curl http://10.187.0.209:3001/v1/health      # must answer, not just localhost
```

The phone must be on the same Wi-Fi. Metro binds `*:8081` already, so only the
API needs the override.

### Checking what the app will actually talk to

The base URL is baked into the manifest at start time, so read it back rather
than guessing:

```bash
curl -s -H "expo-platform: android" -H "accept: application/expo+json,application/json" \
  http://10.187.0.209:8081/ | python3 -m json.tool | grep -i apibaseurl
```

You can also change it at runtime from the app's **Connection** screen, which
writes an override into SQLite that wins over the built-in value — useful when
the laptop's IP changes mid-demo.

### Testing the offline outbox

The reason the native app exists. Load the run, enable airplane mode, then
record arrival, start unload, and complete a delivery with signature and photo.
The header should read `Offline` and the stop should show an unsent count. Turn
Wi-Fi back on: the drain fires on the `Offline → Connected` edge, and the
**Unsent records** screen shows the real counts the server returned.

---

## 5. Working without the backend

The contract is frozen and a Prism mock serves every endpoint from the
committed bundle, with realistic examples:

```bash
pnpm mock          # :4010
```

**The mock serves paths at the root** — `http://localhost:4010/orders`, not
`/v1/orders`. The base URL is the only difference from the real API. Prism
enforces the security schemes, so send any bearer token.

Two limits worth knowing before you debug against it:

- It returns the **static example** from the spec regardless of what you send.
  So a replayed batch cannot report `duplicates`, and the ids in `results[]`
  will never be the ones you sent. The mobile transport has a clearly-commented
  dev-only branch that settles by position against the mock and labels the
  `sync_log` row `mock-response: settled by position`, so a mock run is never
  mistaken for a real one.
- It cannot validate business rules, so a 409 or a 422 the real API would
  return comes back as a 200.

---

## 6. Checks

Everything CI runs, in the same order:

```bash
pnpm contract:lint        # the OpenAPI document must be valid
pnpm gen:check            # pnpm gen && git diff --exit-code
pnpm typecheck            # 8 tasks
pnpm lint                 # 3 tasks (api has no eslint config)
pnpm test                 # 4 tasks: core 89, mobile 190, api 29, allocator 12
```

`gen:check` regenerates the bundle and the client types, then fails if the tree
is dirty — so **it will fail while you have uncommitted work**, which is not
drift. To check the generated artefacts specifically:

```bash
pnpm gen && git status --short packages/contracts/src/schema.gen.d.ts packages/contracts/dist/openapi.json
```

CI also applies migrations, runs a `prisma migrate diff` drift gate against a
shadow database, and seeds. `apps/api` needs its Prisma client generated before
typecheck on a clean checkout:

```bash
pnpm --filter @katapatha/api db:generate
```

---

## Troubleshooting

**`EADDRINUSE` on 3001 / 3000 / 8081.** Something is already serving. Find it
rather than guessing, and kill by PID — a broad `pkill -f "tsx watch"` will also
take out a teammate's or your own other dev server:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

**`Cannot connect to the Docker daemon`.** Docker Desktop is not running. Start
it and wait for the daemon before `pnpm db:up`:

```bash
open -a Docker
until docker info >/dev/null 2>&1; do sleep 5; done
```

**Prisma says it cannot reach `localhost:5432`.** The container is stopped, not
missing. `pnpm db:up` again; `docker compose ps db` should say `healthy`.

**Expo prints no QR code.** It only draws the QR to an interactive terminal, so
you will not get one if you background the process or redirect its output.
`CI=1` also suppresses it. Either run it in the foreground, or point Expo Go at
`exp://<LAN-IP>:8081` by hand.

**Metro cannot resolve `@katapatha/*`.** This should not happen — it is what
[apps/mobile/metro.config.js](../apps/mobile/metro.config.js) is for, adding the
workspace root to `watchFolders` and both `node_modules` directories to
`nodeModulesPaths`. If you are changing that file: do **not** set
`resolver.disableHierarchicalLookup`. pnpm depends on hierarchical lookup,
because each package's own dependencies live in a nested `node_modules` inside
the store, and turning the walk-up off leaves `expo-router` unable to resolve
its own peers.

**Hand-writing a `StopEvent` id for a curl test and getting a 422.** Event ids
are Crockford base32, which excludes **I, L, O and U**:
`^[0-9A-HJKMNP-TV-Z]{26}$`. `01JS...UN1` is rejected; `01JS...NK1` is fine. In
real use the id comes from `@katapatha/core/offline/ulid`.

**Mobile tests and `node:sqlite`.** `expo-sqlite` is a native module and cannot
run under Node, so the tests drive the same DDL and the same SQL through
`node:sqlite` via the seam in `apps/mobile/src/db/driver.ts`. Nothing is mocked;
if those tests pass, the real schema works. They need Node 24.

---

## Ports

| Port | What |
|---|---|
| 3000 | web (Next.js) |
| 3001 | api (Fastify) — `/v1` prefix |
| 4010 | Prism mock — **paths at the root, no `/v1`** |
| 5432 | Postgres (Docker) |
| 8081 | Metro / Expo dev server |
