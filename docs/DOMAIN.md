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
1  STORE       place order, before the 16:00 cutoff        -> Order QUEUED (+ OrderLine per product)
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

## Products, and what an order contains

An order is still the allocation unit: one temperature requirement, and total
`units`, `weightKg` and `volumeM3`. The allocator, plans, load checks,
shortfalls and the driver's delivery all work on that and nothing finer.

A store picks from a **catalogue** (`Product`: SKU, name, brand or every brand,
temperature, unit label such as bag or carton, and the real `kgPerUnit` and
`m3PerUnit`). Dispatchers maintain it — add, edit, deactivate, never delete —
and every signed-in role may read the active part of it. A store sees the
products for its own outlet's brand plus the every-brand ones. The catalogue is
Waypoint-wide, not per depot.

Placing an order with `items` splits the basket into **one order per
temperature**, exactly as two `lines` always became two orders. Each order's
units are the sum of its quantities, and its weight and volume are the real sums
of the products' sizes, not the estimate taken from the outlet's history. Each
order then carries `OrderLine` rows holding **snapshots** of the SKU, name, unit
label and size, so renaming or re-sizing a product never rewrites a placed
order. The older units-only `lines` form still works and leaves no `OrderLine`
rows.

The breakdown is **context, not a second unit of account.** The loader's load
list, the driver's run (and the offline bootstrap), the store's orders and its
incoming delivery, and the dispatcher's orders all show `items`; but a load
check still counts the order's units, and a delivery is still recorded in units
for the order. There is no per-product check, per-product delivered quantity or
per-product shortfall.

The competition data has no products. The catalogue is **demo data** invented
for the demo (the seed says so), and only the synthetic fixture's own orders are
given a made-up breakdown into it; the competition's orders have none and are
never given one.

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

## What the product may claim, and how

From `PRODUCT.md`, which is binding. Each of these is a claim the product is
allowed to make *because* something real backs it. The wording matters: the
limit is never hidden, it is stated beside the number.

- **Position is reported by the driver's phone, not tracked.** There is no
  telematics hardware and the datasets carry no coordinates. A vehicle's
  position is whatever its driver's phone last sent — attached to a stop event,
  or a light periodic ping while the app is open. So the honest unit is the
  **age of the last report**, not a live dot: "last reliable update · 22 min
  ago". Never imply continuous tracking, and never show a position without its
  age. When the age grows past the point of usefulness the vehicle is in **Lamp
  Mode** — the driver keeps working and recording, and the UI says the arrival
  time is estimated from the last known position rather than observed.
- **An arrival time is a range once it is uncertain.** A single clock time is
  shown only while a fresh report supports it. Under Lamp Mode the store sees a
  range, and a countdown appears only when it is positive and under four hours —
  a wrong countdown is worse than none. The five fixed delivery steps and "how
  many stops before mine" remain the floor the store can always rely on.
- **Offline durability is verified on the native driver app.** The outbox in
  `apps/mobile` holds work on the phone and replays it idempotently; its
  acceptance test is the release gate. Copy for it is gated behind
  `OFFLINE_DURABILITY_VERIFIED` in `apps/mobile/src/outbox/claims.ts` — route
  wording through that module rather than writing it per screen. The web driver
  PWA has no outbox and must not claim one. Connectivity labels are `Checking`,
  `Connected`, `Offline`, based on a real request to `/v1/health`, never on
  `navigator.onLine` alone.
- **The map is schematic, and says so.** Stops are drawn at their district
  centre, not the outlet's address, and legs are straight depot-to-district
  lines rather than roads. Reported positions are plotted as reported. Do not
  present any of it as a road route.
- **A product is orderable, not available.** There is no stock, inventory or
  price anywhere in the system: nothing knows what a depot holds or what
  anything costs. The catalogue answers "what can be ordered", so never write
  "in stock", "available" or "out of stock" against a product, and never show a
  price. A product that was deactivated is simply no longer offered.
- **A chiller reading is a reading, not a sensor feed.** Temperature is entered
  by a loader at the bay or a driver on arrival, and carries who read it and
  when. Never present it as live telemetry.
