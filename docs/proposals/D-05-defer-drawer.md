# D-05 "Defer order" drawer: contract additions

**Status:** implemented on `finish/d05-defer-drawer` (stacked on PR #17). Needs review from BE2 (planning routes) and WEB1 (dispatcher plan page).
**Figma:** D-05 Defer order, file `kmgvjSEO1R4m7RCn1eaIQa`, node `128:1540`
**Rule:** additive only (CONVENTIONS.md rule 8). No path changes, no field removals.

### What shipped vs. the original proposal

- A1–A5, B1 and C1 steps 1–3 are built as described below.
- **A4 uses the reference calendar**, not "+1 day". `movesTo.date` is the next
  `CalendarDay` with `isOperating`, so Sundays and holidays like 14 Apr are
  skipped. Outside the calendar it skips Sundays.
- **Permanent causes are handled honestly.** When the allocator marks a deferral
  `permanent` (no vehicle in the fleet can carry it as it stands):
  `movesTo.firstOnRun` is `false`, the drawer says "this was not a choice
  between orders" in place of the lane ranking, publish leaves
  `Deferral.rolledToDate` empty, and the store is told the order "could not be
  delivered today" instead of being promised a slot. The demo seed's one
  deferral, DEMO-012 (45 m³), is exactly this case.
- The store message is built by one function, `deferralMessage()` in
  `@katapatha/core/domain/deferral`. The API writes it into the notification
  and the drawer previews the same string.
- C1 step 4 (rolling the order into tomorrow's queue) is **not** done. It's
  still its own ticket.

## Why

The dispatcher plan page has an inline deferral card (PR #17, commit 13): radio
reasons, a "Suggested" chip and a store-notification preview. Figma D-05 is a
right-hand drawer that also explains *why this order and not another* and
*when it moves to*. Today the web cannot draw that honestly, because:

1. The "Suggested" chip is hard-coded to `REEFER_FULL` in
   `apps/web/src/app/dispatcher/plans/[planId]/deferral-row.tsx`. The
   allocator's real cause is stored in `Assignment.explanation` but
   `GET /plans/{planId}` does not return it.
2. The deferral row has only `assignmentId`, `orderId`, `orderRef`,
   `reasonCode`. The drawer header needs outlet, brand, units, m³ and window.
3. There is no next-run date anywhere, and no competing-orders comparison.
4. **Honesty gap, needs fixing whatever we do with the drawer:** the publish
   contract says publishing "notifies deferred outlets", and the inline card
   previews that message. But the publish handler writes no `Notification`. It
   also leaves `Deferral.rolledToDate` and `Deferral.storeNotifiedAt` unset, and
   drops the `note` from `PUT /plans/{planId}/deferrals`. The UI is promising
   something the server doesn't do yet.

## What D-05 shows, and where each piece would come from

| Drawer section | Data needed | Exists today? | Proposal |
|---|---|---|---|
| Header: `S1-083 · Chilled goods`, `OUT074 · Puttalam · Fresh · 205 units · 2.6 m³ · window 05:30–08:00` | outlet id + name, district, brand, temp, units, volumeM3, window | On `Order` / `Outlet`, not in the response | **A1** add an `order` summary to each deferral row |
| "Why it can't go today" | allocator cause, explanation lines, near miss, suggestion | Stored in `Assignment.explanation` JSON | **A2** expose it as `cause` |
| "Suggested" reason | map the allocator `RejectionCode` → `DeferralReasonCode` | No | **A3** `suggestedReasonCode`, computed on the server |
| "Why this order and not another" + Lowest / Protected / High impact chips | other orders in the same lane (brand + district) with priority rank and a reason | `priorityScore` / `explainPriority` in `packages/allocator/src/prioritise.ts` | **B1** new read endpoint |
| "Moves to · Wed 30 Sep · 05:30–08:00 · First on the run" | next run date, window, whether it will be top priority | No | **A4** `movesTo` on the row |
| "Fathima Rizvi (OUT074) will see …" | outlet store-manager name | `User.outletId` | **A5** `notifyRecipient` |
| "Defer and notify store" | a store notification actually written at publish | No | **C1** server behaviour, no contract shape change |

## A — additive fields on `GET /plans/{planId}` → `deferrals[]`

All optional, so existing consumers and Prism mocks keep working.

```yaml
# packages/contracts/openapi/paths/planning.yaml → deferrals.items.properties
order:
  type: object
  required: [outletId, brand, districtName, units, volumeM3, windowOpen, windowClose]
  properties:
    outletId:        { type: string, examples: ["OUT074"] }
    outletName:      { type: [string, "null"], examples: ["Puttalam"] }   # Outlet.displayName
    brand:           { type: string, examples: ["Fresh"] }
    districtName:    { type: string, examples: ["Puttalam"] }
    tempRequirement: { type: string, examples: ["CHILLED"] }
    units:           { type: integer, examples: [205] }
    volumeM3:        { type: number, examples: [2.6] }
    windowOpen:      { type: string, examples: ["05:30"] }
    windowClose:     { type: string, examples: ["08:00"] }
    deferredYesterday: { type: boolean, examples: [false] }
cause:                       # straight from Assignment.explanation
  type: [object, "null"]
  properties:
    rejectionCode: { type: string, examples: ["NO_REEFER_AVAILABLE"] }
    permanent:     { type: boolean }
    explanation:
      type: array
      items:
        type: object
        required: [code, count]
        properties:
          code:   { type: string }
          count:  { type: integer }
          sample: { type: [string, "null"] }
    nearMiss:
      type: [object, "null"]
      properties:
        vehicleId: { type: string }
        metric:    { type: string }
        short:     { type: number }
        unit:      { type: string }
    suggestion: { type: [string, "null"], examples: ["fits if VEH003 returns from the workshop"] }
suggestedReasonCode: { type: [string, "null"], examples: ["REEFER_FULL"] }
movesTo:
  type: [object, "null"]
  properties:
    date:        { $ref: "../components/schemas/common.yaml#/DateOnly" }
    windowOpen:  { type: string }
    windowClose: { type: string }
    firstOnRun:  { type: boolean, description: "True because a deferred order gets priority rule 1 the next day." }
notifyRecipient:
  type: [object, "null"]
  properties:
    name:     { type: string, examples: ["Fathima Rizvi"] }
    outletId: { type: string, examples: ["OUT074"] }
```

### A3 — suggested reason mapping (server-side, lives in `@katapatha/core`)

| Allocator `RejectionCode` | Suggested `DeferralReasonCode` |
|---|---|
| `NO_REEFER_AVAILABLE`, `NO_REEFER_IN_FLEET` | `REEFER_FULL` |
| `NO_VAN_AVAILABLE`, `NO_VAN_IN_FLEET` | `NO_VAN` |
| `WINDOW_UNREACHABLE` | `WINDOW_UNREACHABLE` |
| `PREDAWN_BUDGET_EXCEEDED`, `DAYTIME_BUDGET_EXCEEDED`, `NO_TRIP_SLOT`, `DISTRICT_UNREACHABLE_IN_BUDGET` | `TIME_BUDGET` |
| `FUEL_QUOTA_EXCEEDED` | `FUEL_QUOTA` |
| `VEHICLE_IN_WORKSHOP` | `VEHICLE_IN_WORKSHOP` |
| `ORDER_EXCEEDS_FLEET_CAPACITY`, `VOLUME_CAP_EXCEEDED`, `WEIGHT_CAP_EXCEEDED` | `ORDER_TOO_LARGE` |
| `YIELDED_TO_HIGHER_PRIORITY`, `WRONG_DEPOT` | `null` (no suggestion; the dispatcher picks) |

Placing it in core means the web and the API can't disagree about it, and a
unit test covers every `RejectionCode`.

### A4 — next run date

`movesTo.date` is the first `CalendarDay.isOperating` after the plan's date
(`nextOperatingDate()` in core; Sundays are skipped outside the calendar). The
window is the order's own window. `firstOnRun` is `true` because
`prioritise.ts` rule 1 puts a deferred-yesterday order ahead of everything else,
and `false` when the cause is permanent. The copy reads "planned first on the
next run", not "guaranteed".

## B1 — new endpoint: competing orders

```
GET /plans/{planId}/deferrals/{assignmentId}/alternatives
```

This needs its own endpoint because it is a per-drawer read and isn't worth
computing for every row on page load.

```yaml
200:
  type: object
  required: [lane, items]
  properties:
    lane: { type: object, properties: { brand: {type: string}, districtName: {type: string} } }
    items:
      type: array
      maxItems: 5
      items:
        type: object
        required: [orderRef, outletId, decision, rank, impact, why]
        properties:
          orderRef:  { type: string, examples: ["ORD-004312"] }
          outletId:  { type: string, examples: ["OUT033"] }
          outletName: { type: [string, "null"] }
          isThisOrder: { type: boolean }
          decision:  { type: string, enum: [SERVED, DEFERRED] }
          rank:      { type: integer, description: "1 = highest priority in the lane" }
          impact:    { type: string, enum: [lowest, protected, high] }
          why:       { type: string, examples: ["deferred yesterday, window shuts 08:00"] }   # explainPriority()
```

Impact rules, all derived from the existing priority policy, with nothing
invented:

- `protected`: the order has `deferredYesterday`. Rule 1 means it can't be
  skipped twice.
- `lowest`: the lowest `priorityScore` in the lane (normally the deferred order
  itself, which is how the allocator chose it).
- `high`: everything else, ordered by score.

**Not proposed:** the Figma copy "chilled stock lasts until Wed 10:00" and
"festival dairy promo". The dataset holds no shelf-life or promotion data, so
those lines become `explainPriority()` sentences ("deferred yesterday", "4 days
since last served", "window shuts 08:00"). Showing invented business context
would go against PRODUCT.md's spirit.

## C1 — make publish do what the contract already says

There is no contract shape change. Inside the existing publish transaction:

1. Persist the `note` from `PUT /deferrals`. Add `Assignment.note` (migration)
   and copy it to `Deferral.note`.
2. Set `Deferral.rolledToDate` = the next run date (same rule as A4).
3. Write one `Notification` per deferred order for its outlet (`kind:
   "ORDER_DEFERRED"`, body built from the reason label and `rolledToDate`) and
   stamp `Deferral.storeNotifiedAt`.
4. *(Optional, bigger)* roll the order forward. `Order.rolledFromOrderId`
   already exists, so this could create tomorrow's `Order` row with
   `deferredYesterday: true`. This touches the queue for the next day and should
   be its own ticket.

Steps 1–3 are done. The drawer's preview notes that the message is "sent to the
store when the plan is published", which is when the `Notification` row is
written.

## Related: `/planning-days?depot=` 422

Separate from D-05, but in the same file. The contract names the query param
`depot`, but the server schema calls it `depotCode` and rejects others with
`additionalProperties: false`. PR #17 stops sending it, because the server
derives the depot from the session anyway. Suggested fix: accept `depot` on the
server as the contract says, or change the contract to `depotCode` (that's a
breaking change, so it needs LEAD + a consumer).

## Suggested order of work

| # | Owner | Change | Size |
|---|---|---|---|
| 1 | BE2 | A1 + A2 + A5 (read-only joins over existing columns) | S |
| 2 | BE2 + core | A3 mapping in `@katapatha/core` + test | S |
| 3 | BE2 | C1 steps 1–3 (notification honesty) | M |
| 4 | BE2 | A4 `movesTo` | S |
| 5 | BE2 | B1 alternatives endpoint | M |
| 6 | WEB1 | Drawer UI over 1–5, replacing the inline card | M |

Items 1–3 unblock most of the drawer. Item 5 is the only new query.
