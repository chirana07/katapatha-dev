# Changing the API

The OpenAPI document in `packages/contracts/openapi/` is the **source of
truth**, written by hand. The server validates against it, both clients are
typed from it, and the mock is served from it. It is not generated from code.

This is deliberate: it is the only artefact that lets eight people work on day
two. Code-first would leave web and mobile idle until the backend shipped.

## The flow

```
openapi/openapi.yaml        root: info, servers, security, and every $ref
  ├── paths/<resource>.yaml     one file per resource, owned by its route owner
  └── components/schemas/…      shared types (LEAD-owned)
        │
        │  pnpm gen
        ▼
  dist/openapi.json ──┬──> src/schema.gen.d.ts  -> @katapatha/api-client
                      └──> Prism mock :4010     -> web + mobile, from day one
```

## To add an endpoint

1. Add the operation to **your** `paths/<resource>.yaml`.
2. Add the path to `openapi.yaml` — but it is probably already there. Every
   planned `$ref` was written before feature work began, so this file should not
   need editing.
3. `pnpm gen` and commit the regenerated artefacts.
4. `pnpm contract:lint`.
5. Implement it in `apps/api/src/routes/<resource>.ts`, attaching the schema so
   Fastify validates the request.

## Every success response must carry an example

Not a style preference. Prism serves your `examples:` verbatim, so a response
without one returns `{}` and the frontend builds against fiction — worse than
having no mock at all. Examples should be drawn from the seeded fixture so they
look like real data.

## Rules that are not negotiable

- **`ClockTime` is `"HH:MM"`**, `DateOnly` is `format: date`. Never use
  `format: date-time` for an operational clock time. The source data has no
  timezone for times, and the allocator is cross-checked to a tolerance of
  1e-6; a UTC-shifted timestamp reaching the planner produces a wrong plan
  quietly rather than loudly.
- **`TempRequirement` (what an order needs) and `VehicleTemp` (what a vehicle
  can do) are different types.** Never merge them.
- **`RuleCode` (a rule was broken) and `RejectionCode` (the fleet ran out) are
  different vocabularies.** "No reefer is free" is not "you put chilled goods on
  a dry truck."
- **Idempotency is contract, in three places:** `requestId` on placing orders,
  `clientRequestId` on a load check, and the client-minted ULID that *is* a
  StopEvent's primary key. Generate a key once per user intent and reuse it
  across retries.
- **Never describe live vehicle position or background sync.** There is no GPS
  in this system.

## Using the mock

```bash
pnpm mock     # :4010
```

Point your app's base URL at it. Note the mock serves paths at the **root**
(`/orders`), while the real API mounts them under `/v1` (`/v1/orders`) — so the
base URL is the only difference. Prism enforces the security schemes, so send
`Authorization: Bearer anything`.
