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
