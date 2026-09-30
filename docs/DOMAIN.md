# The domain

Waypoint Group runs three retail brands (**Fresh**, **Style**, **Tech**) out of
two depots (**Peliyagoda**, **Kandy**), with roughly 60 vehicles serving 120
outlets. Katapatha carries each operational decision, its reason, and its
outcome from ordering through planning, loading, delivery and store receipt.

*Katapatha* means mirror: one delivery story, visible from four perspectives.

## The four roles

| Role | Scope | Device | Does |
|---|---|---|---|
| **DISPATCHER** | one depot | dense desktop | closes the queue, runs the allocator, confirms deferrals with reasons, publishes, resolves shortfalls |
| **LOADER** | one depot | shared dock tablet, 44px targets | checks each line onto the vehicle, raises shortfalls, releases the vehicle |
| **DRIVER** | one vehicle | phone, patchy signal | claims a vehicle, arrives, unloads, completes with proof of delivery, reports problems |
| **STORE_MANAGER** | one outlet | phone or counter PC | places orders, follows the delivery, confirms receipt, raises issues |

There is no admin role. Reviewer access is a development-only page, not a role.

**Scope is enforced per record, not just per role.** A dispatcher is scoped by
`depotCode`, a store manager by `outletId`, a driver by `defaultVehicleId`.
`apps/api/src/lib/authorization.ts` holds eleven predicates that each return the
row or throw 403. Every mutation calls one.

## The plan-to-receipt loop

```
1  STORE       place order, before the 16:00 cutoff        -> Order QUEUED
2  DISPATCHER  close the queue                             -> PlanningDay OPEN -> CLOSED
3  DISPATCHER  run the allocator                           -> Plan DRAFT + Trips + Assignments
4  DISPATCHER  confirm every deferral with a reason code    -> Deferral, Order DEFERRED
5  DISPATCHER  publish (gated, atomic one-time claim)       -> Plan PUBLISHED, Orders PLANNED
6  LOADER      check each line; shortfalls block departure  -> LoadCheck, Shortfall
6b LOADER      mark ready                                   -> Trip READY
7  DRIVER      arrive -> unload -> complete with POD         -> StopEvents, Order DELIVERED
8  STORE       confirm receipt                              -> ReceiptConfirmation
```

## State machines

**Order** `DRAFT PLACED QUEUED PLANNED LOADED IN_TRANSIT DELIVERED
PART_DELIVERED FAILED DEFERRED CANCELLED`
Only some are written today: `QUEUED` on placement, `PLANNED` at publish,
`DEFERRED`/`CANCELLED` from deferral or shortfall resolution,
`DELIVERED`/`PART_DELIVERED` on completion. `DRAFT`, `LOADED`, `IN_TRANSIT` and
`FAILED` exist in the enum but are never set — they are read as filter buckets.
Do not assume they are populated.

The store manager sees a narrower projection: `queued | planned | on_the_way |
delivered | deferred | cancelled`.

**Plan** `DRAFT -> PUBLISHED`. Publication is an atomic one-time claim; a second
attempt is a 409. Re-running the allocator replaces the existing DRAFT, so
re-running is free and leaves no half-plans.

**Trip** `PLANNED -> LOADING -> READY -> DEPARTED -> COMPLETED`. `READY` is
gated by the loader; `DEPARTED` is set implicitly by the driver's first arrival;
`COMPLETED` when no stop is still pending.

**Stop** `PENDING -> ARRIVED -> UNLOADING -> DONE`, or `FAILED` via a reported
problem.

## Two traps

**`chilled` is not `reefer`.** `TempRequirement {chilled, ambient}` is what an
*order* needs. `VehicleTemp {reefer, ambient}` is what a *vehicle* can do. A
reefer may carry either; an ambient vehicle may not carry chilled. Conflating
these is the documented single most common way to break feasibility rule 2.

**`RuleCode` is not `RejectionCode`.** A `RuleCode` says a rule was broken
("you put chilled goods on a dry truck"). A `RejectionCode` says the fleet ran
out today ("every reefer is committed"). They are deliberately separate
vocabularies and must not be merged.

## Time

Clock times are `"HH:MM"` strings in Asia/Colombo wall clock — never a
timestamp. The source data carries no date and no timezone on times, and every
rule is expressed in wall-clock minutes, so converting would invent information
we do not have. Calendar dates are date-only.

Constants live in `@katapatha/core/domain/types`:

```
TRIP_BUDGET_PREDAWN = 270    Fresh, 03:30-08:00
TRIP_BUDGET_DAYTIME = 480    Style + Tech, from 08:30
MAX_TRIPS_PER_VEHICLE = 2    enforced by a unique index, not just in code
ORDER_CUTOFF = "16:00"
TOLERANCE = 1e-6             matches the external checker exactly
```

Trip duration is free-flow only, and handling is charged **per order, not per
outlet**, with **no return leg**. One consequence is worth knowing before you
build a drag-and-drop board: **resequencing a trip's stops changes its duration
by exactly zero.** Sequence governs loading order (LIFO) and window feasibility,
nothing else. Distance *does* include the return leg, because fuel is really
burned.

## Reason codes, never free text

Free text is unsearchable and uncountable, and a picker with twenty options gets
the first one clicked every time, under pressure, at four in the morning. The
lists live in `@katapatha/core/domain/reasons` and are served by
`GET /v1/reference/vocabularies` — render those rather than hardcoding a copy.

| List | Codes |
|---|---|
| Deferral | `REEFER_FULL` `NO_VAN` `WINDOW_UNREACHABLE` `TIME_BUDGET` `FUEL_QUOTA` `VEHICLE_IN_WORKSHOP` `ORDER_TOO_LARGE` `AFTER_CUTOFF` |
| Shortfall | `MISSING` `DAMAGED` `SHORT_QUANTITY` `NOT_COLD_ENOUGH` |
| Driver problem | `OUTLET_CLOSED` `ACCESS_DENIED` `VEHICLE_BREAKDOWN` `ROAD_BLOCKED` `DELIVERY_REFUSED` |
| Store issue | `ITEMS_MISSING` `ITEMS_DAMAGED` `ARRIVED_WARM` `WRONG_ITEMS` |

A shortfall resolves one of four ways, and each has a real operational meaning:
`SEND_SHORT` (go now, rest next run), `MOVE_TO_TRIP_2`, `HOLD_ORDER` (order
becomes DEFERRED), `CANCEL_LINE` (order becomes CANCELLED).

## What the product must not claim

From `PRODUCT.md`, which is binding:

- **No live vehicle position.** There is no GPS. The store sees five fixed
  delivery steps and "how many stops before mine", which is the honest
  substitute. A countdown is shown only when it is positive and under four
  hours — a wrong countdown is worse than none.
- **No offline durability until it is built and verified.** Connectivity labels
  are `Checking`, `Connected`, `Offline`, based on a real request to
  `/v1/health`, not on `navigator.onLine` alone.
- **The map is schematic.** The dataset has no coordinates, so a stop is drawn
  at its district centre and lines are straight depot-to-district legs, not
  roads. Do not present them as routes.
