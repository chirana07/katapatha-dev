# Katapatha

Delivery coordination for Waypoint Group. One delivery operation, four
role-specific workspaces: **dispatcher**, **loader**, **driver**, **store
manager**.

Three apps over one shared, contract-governed API.

| App | Serves | Stack |
|---|---|---|
| `apps/api` | every client — the contract authority | Fastify 5 + Zod/AJV + Prisma |
| `apps/web` | dispatcher, loader, store consoles, **and** the driver mobile web (PWA) | Next.js 16 |
| `apps/mobile` | the driver native app — optional to install, recommended | Expo / React Native |

## Run it

Requires Node 24 (`.nvmrc`), pnpm 12 and Docker.

> **First install is large.** The Expo native packages are ~90 MB
> (`expo-modules-core`, `expo-sqlite`, `hermes-compiler`), so a first
> `pnpm install` can take a long time on a slow connection. If you are not
> working on the mobile app, install only what you need:
> `pnpm install --filter @katapatha/api... --filter @katapatha/web...`
> The committed lockfile already covers all nine workspace projects, so this
> does not change it.

```bash
pnpm install
pnpm db:up                      # Postgres 17 in Docker
pnpm --filter @katapatha/api exec prisma migrate deploy
pnpm db:seed                    # seeds from the committed synthetic fixture
pnpm dev                        # api :3001, web :3000
pnpm mock                       # Prism mock on :4010 (optional, see below)
pnpm --filter @katapatha/mobile start
```

Seeded accounts — password `waypoint` for all five:

| Email | Role |
|---|---|
| nimal@waypoint.lk | DISPATCHER |
| ranjith@waypoint.lk | LOADER |
| sunil@waypoint.lk | DRIVER |
| fathima@waypoint.lk | STORE_MANAGER |
| asha@waypoint.lk | ADMIN |

## Check it

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm contract:lint              # the OpenAPI spec must be valid
pnpm gen:check                  # generated client must match the spec
```

## You are not blocked by the backend

The contract is frozen and a **Prism mock** serves every endpoint with
realistic examples. Build your screen against the mock, then switch the base
URL when the real endpoint lands.

```bash
pnpm mock
# real API:  http://localhost:3001/v1
# mock:      http://localhost:4010      <- note: mock serves paths at the ROOT
```

## Where to read next

| Doc | Read it when |
|---|---|
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | **first** — your first pull request |
| [docs/WORK-BREAKDOWN.md](docs/WORK-BREAKDOWN.md) | what you own and which day it is due |
| [docs/STARTER-TASKS.md](docs/STARTER-TASKS.md) | your concrete first pull request |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | before you create a file or open a PR |
| [docs/CONTRACT.md](docs/CONTRACT.md) | you need to change the API |
| [docs/DOMAIN.md](docs/DOMAIN.md) | you are unsure what a status or a reason code means |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | you want the shape of the whole thing |
| [docs/PRODUCT.md](docs/PRODUCT.md) | **binding.** What the product is and is not allowed to claim |
| [docs/DESIGN.md](docs/DESIGN.md) | **binding.** Palette, type, spacing, responsive criteria |

## Two things this repo will not let you do

**Import the database outside the API.** `@prisma/client` is a dependency of
`apps/api` only. pnpm's strict `node_modules` means a web or mobile file
importing it fails to resolve. "API-first" is enforced by the module resolver,
not by good intentions.

**Accept a request the contract forbids.** Fastify validates every request body
against the spec's schema, so a handler cannot take a field the contract does
not declare.

## Data

The committed fixture in `apps/api/prisma/seed/fixture/` is **synthetic** and
must stay that way. The real dataset is confidential: place it beside this repo
and set `DATA_DIR`, or copy `docker-compose.override.yml.example`. Never commit
dataset derivatives.
