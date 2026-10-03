# Offline outbox — owner MOB1

This is the mobile app's whole reason to exist. The server side it needs is
built (see "Server side" and "What this app did about it" below):

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
It was run against the real endpoint from this app's own drain and transport on
2026-10-03 (see "Verified against the API" below), but never from a device.

## What this app did about it — 2026-10-03

The four things the server could not do from its side are done in this app, each
covered by tests that run real SQLite through `node:sqlite`:

1. **Multi-page proof of delivery.** Migration 2 adds `outbox_page` (`id` = the
   page's client ULID, `event_id` -> `outbox_event` ON DELETE CASCADE, `seq`,
   `kind` RECEIPT|SIGNATURE|PHOTO, `data` = the base64 data URL, `quality_flags`
   = JSON text, `captured_at`, `payload_bytes`). `deliveryIntent` takes `pages`
   (1..`MAX_POD_PAGES` = 8, validated by `podPagesProblem`: data-URL shape,
   1,048,576-character cap, flag pattern, unique ids) and emits no legacy
   `signatureData` / `photoData`. `repo.enqueue` writes the events and their
   pages in one transaction; `claimBatch` attaches `pages` (ordered by `seq`) to
   the POD rows it claims and nowhere else; `payload_bytes` counts pages. The
   legacy columns stay for rows queued by an older build, which still send them.
   The images are selected at drain time only and set to NULL the moment the
   event is confirmed, a conflict or rejected (`settleResults`, `rejectBatch`);
   the page row stays, so "2 pages" is still true after the images are gone, and
   it is deleted with its event by `prune`. A delivery's lines and POD still go
   in one batch. A group over `MAX_BATCH_BYTES` (8 x 400 KB pages exceeds it by
   design -- the server allows 12 MiB) is still taken alone; the byte cap decides
   how many *groups* share a request.
2. **`rejected` is read and settled terminally.** `readBatchResult` reads
   `rejected: [{ id, code, message }]`. Each id we sent becomes a `rejected`
   outcome: state `rejected`, `last_error` the sentence from
   `describeRejection()` (`src/driver/rejections.ts`: plain wording for every
   code in the contract, generic terminal wording for an unknown one, never
   "failed"), images dropped, never claimed again. An id in neither `results`
   nor `rejected` is still requeued with backoff ("not reported" = not applied =
   safe to resend). `results` wins if an id appears in both. The ok result and
   `DrainOutcome` carry `rejected`; `sync_log` has a `rejected` column. A batch
   in which some rows were refused is still a `sent` drain.
3. **A whole-request 403/422 keeps its old meaning**: the request itself was
   refused. 403 holds the rows and retries; 422 rejects the batch (and now drops
   its images too).
4. **The 501 per-stop fallback is deleted** (`sendPerStop`, the branch, its
   tests). A 501 from `/sync/stop-events` is now an ordinary retryable 5xx. The
   Prism mock's settle-by-position path stays.

Two smaller things came with it: `repo.enqueue` uses `ON CONFLICT DO NOTHING`
instead of `INSERT OR IGNORE` (which would also have swallowed a CHECK or NOT
NULL violation and silently dropped a record), and a delivery's line events are
minted before its POD, so ULID order is event order.

Stop facts for the screens come from `readStopRecords` (`src/sync/stopRecords.ts`):
arrival and unload times (device clock), completion, recipient, per-order units,
page count, outcome and reason, from outbox rows only and without ever selecting
a blob. `startDeliveryIntent` records ARRIVED + UNLOAD_START as one intent.

## Verified against the API — 2026-10-03

`src/outbox/transport.ts`, `drain.ts` and `repo.ts` were driven, unchanged,
against the running API (`http://localhost:3201/v1`, demo day 2026-04-09) as
sunil@waypoint.lk with a real `createKatapathaClient` and a bearer token, over
`node:sqlite`. A throwaway script (not in the repo) queued a start-delivery, a
two-page delivery (a PNG receipt page with `CORNERS_NOT_CONFIRMED`, an SVG
signature page) for a PENDING stop with two orders, and one FAILED event for a
stop that is not on the run:

- Clean drain: `accepted=5, duplicates=0, rejected=1`; the FAILED row landed
  `rejected` locally with the readable "not on your run" sentence; page images
  were NULL locally and both page rows kept; `GET /sync/stop-events?sinceSeq=0`
  listed the POD with two pages (RECEIPT, SIGNATURE, ids, flags, capturedAt) and
  no legacy fields; re-posting the identical batch gave `accepted=0,
  duplicates=5` and the event count did not change.
- Lost response (the server applied the request, the phone never heard): the
  six rows stayed queued with their images, the next drain sent the same ids and
  got `duplicates=5, rejected=1, accepted=0`, no new rows, stop `DONE`.

**Still not verified:** this has never run on a device. The camera, a real
receipt photo's size and encoding, `expo-sqlite` (the tests use `node:sqlite`; the
SQL is the same, the binding is not), the foreground drain triggers, and the
network failure modes of a real handset are unexercised. `ON CONFLICT DO NOTHING`
needs SQLite 3.24+, which expo-sqlite bundles, but that was not run on a device.
