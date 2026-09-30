# Architecture

## Why there is an API at all

The previous application worked, but it was a single Next.js app driven by
Server Actions — 22 inline `FormData` actions and only four route handlers. Two
things made that untenable: a **React Native app cannot call a Server Action**,
and a single app cannot be split across eight developers without constant
collisions. So the logic stayed and an API went in front of it.

## The shape

```
                     ┌──────────────────────────────┐
   apps/web ────────>│                              │
   (Next 16)         │   apps/api   Fastify 5       │──> Postgres 17
   dispatcher        │   the contract authority     │    (Prisma)
   loader            │                              │
   store             │   routes/  one file per      │
   driver PWA        │            resource          │
                     │   services/ ported, unchanged│
   apps/mobile ─────>│   lib/     auth, authz, audit│
   (Expo)            └──────────────────────────────┘
   driver native                    ▲
                                    │ validates against
                     packages/contracts (OpenAPI, hand-written)
                                    │ generates
                     packages/api-client (typed fetch)
```

## Packages

| Package | What | Depends on |
|---|---|---|
| `@katapatha/core` | `domain/` + `validation/` + `offline/` — pure business rules and the plan validator. 89 tests. | **nothing** |
| `@katapatha/allocator` | `allocate()` — pure, deterministic, 6 phases. Plus node-only CSV scenario loaders. | core |
| `@katapatha/contracts` | the OpenAPI document, its bundle, and generated types | — |
| `@katapatha/api-client` | typed `openapi-fetch` client, cookie or bearer | contracts |
| `@katapatha/tokens` | the one palette, as CSS and as TS for React Native | — |

**`core` and `validation` are one package on purpose.** They cannot be split:
`validation/` imports `domain/` in production code, and `domain/`'s tests import
`validation/fixtures`. Splitting them creates a circular dependency between
packages.

**There is no `packages/db`.** Prisma lives in `apps/api` alone, so a web or
mobile file that imports `@prisma/client` fails to resolve under pnpm's strict
`node_modules`. That makes "API-first" a property of the build rather than a
rule people have to remember.

## Why Fastify

Three backend developers working in parallel, and the thing most likely to cost
a day is a shared file. NestJS puts every endpoint in a `@Module({ controllers
})` array, so three people adding endpoints collide by construction. Fastify
with `@fastify/autoload` discovers routes from the filesystem: **there is no
registry file to conflict on.**

The second reason matters just as much: Fastify validates with AJV/JSON Schema
natively, which is the same language the OpenAPI document is written in. A
handler attaches the spec's schema and therefore **cannot accept a body the
contract forbids.** Request-side drift is structurally impossible rather than
merely discouraged.

## Auth, and why mobile needed no schema change

`POST /v1/auth/session` sets an httpOnly cookie **and** returns the same opaque
token in the body. The web app uses the cookie; the mobile app keeps the token
in SecureStore and sends `Authorization: Bearer`. The server accepts either and
looks up the same `Session` row — only a sha256 hash of the token is stored.

Web and API are served **same-origin** behind the reverse proxy in production
(`/v1/*` to the API), so CORS and `SameSite` never come up.

The 30-day non-rotating session is a considered choice, not an oversight: a
driver's phone must stay signed in across a stretch with no coverage, and a
short rotating token would sign them out exactly when they can do nothing about
it. The offline outbox depends on it.

## The one genuinely new subsystem

Everything else is a port. The **offline outbox** is not: the data model was
fully designed in the previous repo (`StopEvent.source`, `ConflictState`,
`SyncLog`, `StopReassignment`, ULID primary keys) but there was no sync endpoint
and no outbox.

The design decision that makes it small: `POST /v1/stops/{stopId}/events` and
`POST /v1/sync/stop-events` **share one applier**. The sync endpoint is the stop
endpoint, batched and unscoped. So the online path and the offline path are the
same request shape, and the mobile outbox has exactly one write to replay. And
because the client mints each event's ULID — which *is* the primary key —
replay is idempotent by construction rather than by careful coding.

See `apps/mobile/src/outbox/README.md`.

## Deployment

Docker Compose on a VPS: Postgres, the API, the web app, and a reverse proxy
terminating one origin. The mobile app ships as a single EAS-built Android APK;
during development it runs in Expo Go. No app store.
