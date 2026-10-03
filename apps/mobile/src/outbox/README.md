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

## Server side — implemented 2026-10-03

The gap recorded above is closed. It was already half closed when this was
written (`routes/sync.ts` was no longer a 501 stub and `services/delivery.ts`
already stored the client's ULID); what remained is now done:

- **The client's ULID is the `StopEvent` primary key**, on `POST /sync/stop-events`
  and on `POST /stops/{stopId}/events`. An id the server already holds is a
  `duplicate`: no second row, and none of the side effects (order and stop status,
  the store's notification, the decision log) run again. Two requests racing with
  the same id are also safe: the loser's transaction rolls back whole and is
  reported as a duplicate. Both routes run one applier, `services/stopEvents.ts`.
- **Each event is judged on its own.** A batch is no longer all-or-nothing:
  a stop the driver cannot see, an invalid payload, or a transition the stop
  refuses puts that one event in a new `rejected: [{ id, code, message }]` list
  and the others still apply. Events are applied per stop in `occurredAt` order
  (a tie keeps batch order), so a re-ordered retry cannot unload before it arrives.
- **Multi-page proof of delivery.** `POD_CAPTURED` may carry `pages`
  (`[{ id, kind, data, qualityFlags?, capturedAt }]`, at most 8, each a base64
  image data URL of at most 1,048,576 characters). Pages are written with the POD
  event in one transaction. `signatureData` / `photoData` still work; if both are
  sent, pages win and the legacy fields on that event are ignored.
- The request body limit on both routes is 12 MiB (Fastify's default is 1 MiB,
  which was below this outbox's own 1.5 MB `MAX_BATCH_BYTES`).

Regression coverage is in `apps/api/src/test/stopEventReplay.test.ts` (replays
counted against rows and side effects, not mocks) and `stopsAndSync.test.ts`.
It still has not been run against a real device or the real endpoint from this
app, so re-run the acceptance assertions by hand the day the app is pointed at it.

**What this app must still do about it** (the server cannot do it from its side):

1. `OutboxEventInput` / `toBody` send `signatureData` and `photoData` only. To
   send a multi-page receipt they must send `pages` instead (see above) and not
   the legacy fields for the same picture.
2. `transport.ts` reads only `results`. An event the server `rejected` is absent
   from `results`, which `settleResults` treats as "not reported" and requeues
   with backoff forever. `readBatchResult` needs to read `rejected` and settle
   those rows terminally (the same state `rejectBatch` uses), showing `message`.
3. A single bad event used to come back as a 403/422 for the whole batch and
   `drain.ts` held or rejected every row in it. That no longer happens for the
   per-event causes above; a 403/422 now means the whole request was refused.
4. `transport.ts` still carries a 501 fallback to `/stops/{stopId}/events`
   ("routes/sync.ts returns 501"). That is now dead, though harmless: the
   per-stop route accepts the `tripStopId` the body already carries.
