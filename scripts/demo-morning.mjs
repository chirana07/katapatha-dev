#!/usr/bin/env node
/* eslint-env node */

/**
 * Takes a freshly reset demo database to a *busy morning*, so the dispatcher,
 * loader, driver and store screens have something to show beyond an empty list.
 *
 *   pnpm demo:reset --yes && node scripts/demo-morning.mjs
 *
 * What it leaves behind, on the hero day (2026-04-09):
 *   - the queue closed, a plan built, every deferral given a reason, published
 *   - one trip fully loaded and released; one with a SHORT load (an open
 *     shortfall, blocking departure); one half-checked; the rest untouched
 *   - the driver's vehicle out: one stop delivered, the next arrived at
 *   - a fresh position for the driver's vehicle, and a chiller reading outside
 *     its band on a reefer trip still at the dock
 *   - two more vehicles departed: one running late, one in Lamp Mode (its last
 *     report is old)
 *   - a driver-raised problem and a store-raised issue
 *
 * Everything goes through the HTTP API except the two vehicles the single seeded
 * driver cannot play — those are set up in SQL through `psql`, because the
 * seed has exactly one driver account. Needs DATABASE_URL for that part.
 *
 * Idempotent in the only way that matters here: run it once after a reset. A
 * second run finds the day already published and stops.
 */

import { spawnSync } from "node:child_process";

const BASE = (process.env.API_BASE_URL ?? "http://localhost:3001/v1").replace(/\/$/, "");
const DATE = process.env.SCENARIO_DATE ?? "2026-04-09";
const PASSWORD = "waypoint";
let cookie = "";

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie: `katapatha_session=${cookie}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function must(label, method, path, body, ok = [200, 201]) {
  const r = await call(method, path, body);
  if (!ok.includes(r.status)) throw new Error(`${label}: ${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function signIn(who) {
  const r = await call("POST", "/auth/session", { email: `${who}@waypoint.lk`, password: PASSWORD });
  if (!r.data?.token) throw new Error(`sign-in ${who}: ${r.status}`);
  cookie = r.data.token;
  return r.data.user;
}

function ulid() {
  const a = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const ts = Date.now();
  const t = Array.from({ length: 10 }, (_, i) => a[Math.floor(ts / 32 ** (9 - i)) % 32]).join("");
  return t + Array.from({ length: 16 }, () => a[Math.floor(Math.random() * 32)]).join("");
}

function psql(sql) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is needed for the SQL part of the scenario");
  const r = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}

const log = (m) => console.log(`  ${m}`);

async function main() {
  console.log(`Scenario → ${BASE}, ${DATE}`);

  // ---- dispatcher: close, plan, confirm, publish --------------------------
  await signIn("nimal");
  const days = await must("days", "GET", `/planning-days?date=${DATE}`);
  const day = days[0];
  if (!day) throw new Error("no planning day — run pnpm demo:reset first");
  if (day.status === "PUBLISHED") { log("already published — nothing to do"); return; }
  if (day.status === "OPEN") await must("close", "POST", `/planning-days/${day.id}/closure`);
  const plan = await must("plan", "POST", "/plans", { date: DATE, depotCode: day.depotCode });
  const board = await must("board", "GET", `/plans/${plan.planId}`);
  const pending = board.deferrals.filter((d) => !d.reasonCode);
  if (pending.length) {
    await must("confirm", "PUT", `/plans/${plan.planId}/deferrals`, {
      decisions: pending.map((d) => ({ assignmentId: d.assignmentId, reasonCode: d.suggestedReasonCode ?? "REEFER_FULL" })),
    });
  }
  await must("publish", "POST", `/plans/${plan.planId}/publication`);
  log(`published: ${board.trips.length} trips, ${board.deferrals.length} deferred`);

  // ---- loader: three trips in three states --------------------------------
  await signIn("ranjith");
  const trips = await must("trips", "GET", `/trips?date=${DATE}`);
  const driverVehicle = "VEH101";
  const ready = trips.find((t) => t.vehicleId === driverVehicle && t.tripNo === 1) ?? trips[0];
  const short = trips.find((t) => t.id !== ready.id && t.vehicleId !== driverVehicle) ?? trips[1];
  const partial = trips.find((t) => ![ready.id, short?.id].includes(t.id));

  async function checkAll(trip, mutate = (line, i) => ({ loadedUnits: line.expectedUnits, condition: "OK" })) {
    const list = await must("load-list", "GET", `/trips/${trip.id}/load-list`);
    for (const [i, line] of list.lines.entries()) {
      const m = mutate(line, i);
      if (!m) continue;
      await must("check", "PUT", `/trips/${trip.id}/load-checks/${line.orderId}`, {
        checkedByName: "Ranjith Silva", reasonCode: m.condition === "OK" ? null : "SHORT_QUANTITY", ...m,
      });
    }
    return list;
  }

  await checkAll(ready);
  await must("ready", "POST", `/trips/${ready.id}/readiness`);
  log(`ready: ${ready.vehicleId} trip ${ready.tripNo}`);
  if (short) {
    await checkAll(short, (line, i) =>
      i === 0 ? { loadedUnits: Math.max(0, Math.floor(line.expectedUnits * 0.8)), condition: "SHORT" }
              : { loadedUnits: line.expectedUnits, condition: "OK" });
    log(`short load: ${short.vehicleId} trip ${short.tripNo} (open shortfall)`);
  }
  if (partial) {
    await checkAll(partial, (line, i) => (i === 0 ? { loadedUnits: line.expectedUnits, condition: "OK" } : null));
    log(`half-checked: ${partial.vehicleId} trip ${partial.tripNo}`);
  }

  // A reefer trip still at the dock reads warm. Gauge reading by the loader.
  const reefer = [short, partial].filter(Boolean).find((t) => ["VEH101", "VEH103"].includes(t.vehicleId));
  if (reefer) {
    const r = await call("POST", `/trips/${reefer.id}/chiller-readings`, {
      tempC: 6.0, source: "LOADER_AT_BAY", note: "Compressor slow to pull down",
      clientReadingId: `scenario-chiller-${reefer.id}`,
    });
    log(`chiller reading ${r.status} on ${reefer.vehicleId}`);
  }

  // ---- driver: out on VEH101 ----------------------------------------------
  await signIn("sunil");
  await must("claim", "PUT", "/drivers/me/vehicle", { vehicleId: ready.vehicleId });
  const run = await must("run", "GET", `/drivers/me/run?date=${DATE}`);
  // The stop that gets delivered is the signed-in store manager's own outlet when
  // this trip serves it, so the store screens have a delivery to confirm.
  const stops = run.trips.find((t) => t.tripId === ready.id)?.stops ?? [];
  const mine = stops.find((s) => s.outletId === "OUT074");
  const first = mine ?? stops[0];
  const second = stops.find((s) => s !== first);
  if (first) {
    const now = () => new Date().toISOString();
    await must("arrive", "POST", `/stops/${first.id}/events`, { deviceId: "scenario", events: [{ id: ulid(), type: "ARRIVED", occurredAt: now() }] });
    await must("unload", "POST", `/stops/${first.id}/events`, { deviceId: "scenario", events: [{ id: ulid(), type: "UNLOAD_START", occurredAt: now() }] });
    const order = first.orders[0];
    await must("deliver", "POST", `/stops/${first.id}/events`, {
      deviceId: "scenario",
      events: [
        { id: ulid(), type: "DELIVERED", occurredAt: now(), orderId: order.orderId, deliveredUnits: order.expectedUnits, recipientName: "A. Perera" },
        { id: ulid(), type: "POD_CAPTURED", occurredAt: now(), recipientName: "A. Perera" },
      ],
    });
    log(`delivered stop 1 (${first.outletId})`);
  }
  if (second) {
    await must("arrive2", "POST", `/stops/${second.id}/events`, { deviceId: "scenario", events: [{ id: ulid(), type: "ARRIVED", occurredAt: new Date().toISOString() }] });
    log(`arrived at stop 2 (${second.outletId})`);
  }
  // Plan times are early morning; the events above carry the clock of whenever
  // this ran. Re-time the driver's stops to "now" so the slip is plausible
  // (about twelve minutes behind at stop 2), not twelve hours.
  const clockOf = (minutes) => {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  const colomboNow = (() => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    return Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
  })();
  for (const [i, stop] of stops.entries()) {
    const planned = i === 0 ? colomboNow - 40 : i === 1 ? colomboNow - 12 : colomboNow + 30 * (i - 1);
    psql(`UPDATE "TripStop" SET "plannedArrivalAt"='${clockOf(planned)}' WHERE id='${stop.id}';`);
  }
  const idx = (stop) => stops.indexOf(stop);
  void idx;

  // Positions the way the phone sends them: a fresh fix, and one a few minutes old.
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  await must("pings", "POST", "/drivers/me/pings", {
    pings: [
      { clientPingId: `scenario-ping-a-${Date.now()}`, lat: 7.0840, lng: 79.9900, accuracyM: 12, recordedAt: iso(6) },
      { clientPingId: `scenario-ping-b-${Date.now()}`, lat: 7.2906, lng: 79.8500, accuracyM: 9, recordedAt: iso(1) },
    ],
  });
  log("two positions reported");

  // A problem the driver raises on the road. In this API a problem is a FAILED
  // event with a reason code, on a stop further along the run.
  const third = stops.find((s) => s !== first && s !== second);
  if (third) {
    const p = await call("POST", `/stops/${third.id}/events`, {
      deviceId: "scenario",
      events: [{ id: ulid(), type: "FAILED", occurredAt: new Date().toISOString(), reasonCode: "ACCESS_DENIED" }],
    });
    log(`driver problem on stop 3 (${third.outletId}): ${p.status}`);
  } else {
    log("trip has fewer than three stops — no driver problem raised");
  }

  // ---- store: an issue on the delivered order ------------------------------
  await signIn("fathima");
  const orders = await must("orders", "GET", `/orders?date=${DATE}`);
  const delivered = orders.find((o) => ["DELIVERED", "PART_DELIVERED"].includes(o.status));
  if (delivered) {
    const r = await call("POST", "/issues", { orderId: delivered.id, kind: "GOODS_DAMAGED", reasonCode: "ITEMS_DAMAGED", units: 3, note: "Two cartons crushed", clientRequestId: crypto.randomUUID() });
    log(`store issue ${r.status}`);
  }

  // ---- SQL: two vehicles the single seeded driver cannot play ---------------
  const others = trips.filter((t) => t.vehicleId !== ready.vehicleId).slice(0, 4);
  const late = others.find((t) => t.id !== short?.id && t.id !== partial?.id);
  const lamp = others.find((t) => t.id !== late?.id && t.id !== short?.id && t.id !== partial?.id);
  const pingSql = (t, lat, lng, minAgo) =>
    `INSERT INTO "VehiclePing"(id,"vehicleId","tripId",lat,lng,"accuracyM","recordedAt","receivedAt","clientPingId") ` +
    `VALUES ('scn_${t.id}_${minAgo}','${t.vehicleId}','${t.id}',${lat},${lng},10,(now() at time zone 'utc')-interval '${minAgo} minutes',(now() at time zone 'utc'),'scn-${t.id}-${minAgo}') ON CONFLICT DO NOTHING;`;
  for (const [t, kind] of [[late, "late"], [lamp, "lamp"]]) {
    if (!t) continue;
    psql(`UPDATE "Trip" SET status='DEPARTED', "departedAt"=(now() at time zone 'utc')-interval '90 minutes' WHERE id='${t.id}' AND status IN ('PLANNED','LOADING','READY');`);
    if (kind === "late") {
      // Arrived at stop 1 well after its planned time.
      psql(`UPDATE "TripStop" SET status='DONE', "arrivedAt"=(now() at time zone 'utc')-interval '5 minutes', "leftAt"=(now() at time zone 'utc')-interval '2 minutes' WHERE "tripId"='${t.id}' AND seq=(SELECT min(seq) FROM "TripStop" WHERE "tripId"='${t.id}');`);
      // Its planned time is re-set to just before the arrival above, so this one
      // reads as on schedule rather than hours behind.
      psql(`UPDATE "TripStop" SET "plannedArrivalAt"='${clockOf(colomboNow - 8)}' WHERE "tripId"='${t.id}' AND seq=(SELECT min(seq) FROM "TripStop" WHERE "tripId"='${t.id}');`);
      psql(pingSql(t, 6.9271, 79.8612, 1));
    } else {
      psql(pingSql(t, 7.2083, 79.8358, 22));
    }
    log(`${kind}: ${t.vehicleId} trip ${t.tripNo}`);
  }

  console.log("Done.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
