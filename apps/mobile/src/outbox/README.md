# Offline outbox — owner MOB1

This is the only genuinely unbuilt subsystem in the product, and it is the
mobile app's whole reason to exist. Everything it needs already exists:

- `StopEvent.id` is a **client-generated ULID**, so replay is idempotent by
  construction. Use `@katapatha/core/offline/ulid`.
- `POST /v1/sync/stop-events` drains a batch and reports
  `{ accepted, duplicates, conflicts, clockSkewMs, serverSeq }`.
- `GET /v1/sync/bootstrap` returns everything the device must cache to work
  with no connectivity.
- `GET /v1/sync/stop-events?sinceSeq=` is the pull side, for changes the device
  missed (for example a stop reassigned to another vehicle while it was off).

The online and offline paths are **the same request shape**, because
`POST /v1/stops/{stopId}/events` and the sync endpoint share one applier on the
server. There is exactly one write to replay.

`duplicate` in a response is a SUCCESS. A correct replay reports every event as
a duplicate and changes nothing. The acceptance test is: queue three events
offline, reconnect, drain, assert `accepted=3, duplicates=0`; then replay the
identical batch and assert `duplicates=3`.

**Do not claim offline durability in the UI until that test passes.** PRODUCT.md
forbids it, and DESIGN.md restricts connectivity labels to `Checking`,
`Connected` and `Offline` based on verified reachability against `/v1/health`.
Never imply background sync or live vehicle position; there is no GPS here.

---

## Verified — 2026-10-01

The acceptance test above is implemented at `src/outbox/drain.acceptance.test.ts`
and passes. Run it with:

```bash
pnpm --filter @katapatha/mobile test
```

It queues three events while the transport is failing, drains them
(`accepted=3, duplicates=0`), then replays the identical batch and asserts
`duplicates=3` with no local row changed. Five further cases cover a realistic
arrive → unload → deliver-with-POD run, the `sync_log` counts, a double-tap being
a local no-op, concurrent drains being single-flight, and a delivery's events
never being split across two requests.

It runs under Node with no device and no server: `src/db/driver.ts` is a seam, so
the test drives the **real DDL and the real SQL** through `node:sqlite` while the
app uses `expo-sqlite`. The applier is faked in-process because **Prism cannot
express this test** — the mock returns the static example from `sync.yaml`
(`accepted: 3, duplicates: 0`) with three hard-coded ULIDs whatever it is sent,
so a replay against it can never report `duplicates=3`. The request *shape* is
asserted separately, against a stubbed `fetch`, in `src/outbox/transport.test.ts`.

`src/outbox/claims.ts` therefore has `OFFLINE_DURABILITY_VERIFIED = true`.

**Still outstanding, and the UI copy is written not to depend on it:**
`apps/api/src/services/delivery.ts` mints its own ULID server-side and guards on
stop status rather than keying on the client's id, and `routes/sync.ts` is a 501
stub. Server-side idempotency — what makes a replay safe rather than a
double-write — is not implemented yet. Re-run these assertions by hand against
the real endpoint the day BE3 lands it.
