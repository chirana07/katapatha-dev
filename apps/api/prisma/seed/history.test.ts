/**
 * Seed history: the CSV parsers, the aggregation, and the synthetic generator.
 *
 * All pure: nothing here touches a database. The generator tests matter most,
 * because a seeded demo that changes between runs, or that ignores the
 * calendar it claims to follow, would be unmistakably fake.
 */

import { describe, expect, it, vi } from "vitest";
import { splitCsvLine, type CsvRow } from "@katapatha/allocator/csv";
import { allowanceKey } from "@katapatha/core/domain/tripTime";
import type { DistrictTravel } from "@katapatha/core/domain/types";
import { isoWeekOfDate } from "../../src/services/forecast";
import {
  DailyAccumulator,
  ServiceAccumulator,
  generateSyntheticCalendar,
  generateSyntheticDaily,
  generateSyntheticLegs,
  hashString,
  legServiceMinutes,
  mulberry32,
  parseClock,
  parseDeliveryRow,
  parseLegRow,
  seriesFromWeekly,
  toSignalDay,
  weeklyFromDaily,
  type SyntheticOutlet,
  type SyntheticVehicle,
} from "./history";

/** One CSV record against its header, the way readCsv would yield it. */
function rowOf(header: string, line: string): CsvRow {
  const names = splitCsvLine(header);
  const cells = splitCsvLine(line);
  return Object.fromEntries(names.map((n, i) => [n, cells[i] ?? ""]));
}

const DELIVERY_HEADER =
  "delivery_id,order_date,dispatch_date,dispatch_status,outlet_id,brand,district,depot,temp_requirement,order_units,order_weight_kg,order_volume_m3,route_id,seq_in_route,vehicle_id,vehicle_type,vehicle_temp,planned_arrival_time,window_open_time,window_close_time";
const LEG_HEADER =
  "leg_id,date,route_id,depot,vehicle_id,vehicle_type,vehicle_temp,brand,district,seq,from_point,to_outlet,distance_km,planned_depart_time,planned_travel_duration_min,planned_arrival_time,actual_depart_time,actual_travel_duration_min,arrival_time,leave_outlet_time,monsoon,dow";

describe("parseClock", () => {
  it("normalises clock cells and refuses anything that is not one", () => {
    expect(parseClock("5:07")).toBe("05:07");
    expect(parseClock("05:07:30")).toBe("05:07");
    expect(parseClock(" 23:59 ")).toBe("23:59");
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("5.07")).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(parseClock(undefined)).toBeNull();
  });
});

describe("parseDeliveryRow", () => {
  it("reads an order row, including one that never ran", () => {
    const ran = parseDeliveryRow(
      rowOf(DELIVERY_HEADER, "ORD1,2024-01-01,2024-01-01,attempted,OUT001,Fresh,Colombo,Peliyagoda,ambient,8,71.1,0.402,R000015,0,VEH037,van,ambient,05:00,05:00,07:30"),
    );
    expect(ran).toMatchObject({ orderDate: "2024-01-01", status: "attempted", brand: "Fresh", temp: "ambient", volumeM3: 0.402, routeId: "R000015", seqInRoute: 0 });

    const never = parseDeliveryRow(
      rowOf(DELIVERY_HEADER, "ORD2,2024-01-02,,not_run,OUT001,Fresh,Colombo,Peliyagoda,chilled,8,71.1,0.5,,,,,,,05:00,07:30"),
    );
    expect(never).toMatchObject({ status: "not_run", dispatchDate: null, routeId: null, seqInRoute: null });
  });

  it("accepts a differently spaced status and refuses a row it cannot trust, without throwing", () => {
    expect(parseDeliveryRow(rowOf(DELIVERY_HEADER, "O,2024-01-01,2024-01-02,Not Run,OUT001,Fresh,Colombo,Peliyagoda,ambient,1,1,0.1,,,,,,,05:00,07:30"))?.status).toBe("not_run");
    // Unknown status, bad date, bad volume, unknown brand: each is skipped, never half-parsed.
    expect(parseDeliveryRow(rowOf(DELIVERY_HEADER, "O,2024-01-01,,pending,OUT001,Fresh,Colombo,Peliyagoda,ambient,1,1,0.1,,,,,,,05:00,07:30"))).toBeNull();
    expect(parseDeliveryRow(rowOf(DELIVERY_HEADER, "O,01/02/2024,,attempted,OUT001,Fresh,Colombo,Peliyagoda,ambient,1,1,0.1,,,,,,,05:00,07:30"))).toBeNull();
    expect(parseDeliveryRow(rowOf(DELIVERY_HEADER, "O,2024-01-01,,attempted,OUT001,Fresh,Colombo,Peliyagoda,ambient,1,1,abc,,,,,,,05:00,07:30"))).toBeNull();
    expect(parseDeliveryRow(rowOf(DELIVERY_HEADER, "O,2024-01-01,,attempted,OUT001,Other,Colombo,Peliyagoda,ambient,1,1,0.1,,,,,,,05:00,07:30"))).toBeNull();
    expect(parseDeliveryRow({})).toBeNull();
  });
});

describe("parseLegRow", () => {
  it("reads planned and actual times", () => {
    const leg = parseLegRow(
      rowOf(LEG_HEADER, "L0000001,2024-01-01,R000001,Kandy,VEH057,van,reefer,Fresh,Kandy,0,DEPOT,OUT077,8.2,04:24,16,04:40,04:31,17,04:48,05:12,1,0"),
    );
    expect(leg).toMatchObject({
      id: "L0000001",
      outletId: "OUT077",
      fromPoint: "DEPOT",
      plannedArrival: "04:40",
      actualDepart: "04:31",
      arrivalTime: "04:48",
      leaveOutletTime: "05:12",
      monsoon: true,
    });
  });

  it("keeps a leg whose actuals are missing and drops one whose plan is", () => {
    const noActuals = parseLegRow(rowOf(LEG_HEADER, "L2,2024-01-01,R1,Kandy,VEH057,van,reefer,Fresh,Kandy,1,OUT077,OUT079,2.8,04:56,6,05:02,,,,,0,0"));
    expect(noActuals).toMatchObject({ actualDepart: null, arrivalTime: null, leaveOutletTime: null });
    expect(parseLegRow(rowOf(LEG_HEADER, "L3,2024-01-01,R1,Kandy,VEH057,van,reefer,Fresh,Kandy,1,OUT077,OUT079,2.8,,6,,,,,,0,0"))).toBeNull();
  });
});

describe("aggregation", () => {
  it("counts every order once, deferred and never-run included, and sums volume by temperature", () => {
    const acc = new DailyAccumulator();
    const base = { orderDate: "2024-01-01", depot: "Peliyagoda", brand: "Fresh" as const, units: 10, weightKg: 100 };
    acc.add({ ...base, temp: "chilled", volumeM3: 1.25, status: "attempted" });
    acc.add({ ...base, temp: "chilled", volumeM3: 2.5, status: "deferred" });
    acc.add({ ...base, temp: "ambient", volumeM3: 4, status: "not_run" });
    const rows = acc.rows();
    expect(rows).toHaveLength(2);
    const chilled = rows.find((r) => r.temp === "chilled")!;
    expect(chilled).toMatchObject({ orders: 2, volumeM3: 3.75, deferred: 1, notRun: 0, units: 20, weightKg: 200 });
    expect(rows.find((r) => r.temp === "ambient")).toMatchObject({ orders: 1, notRun: 1, deferred: 0 });
  });

  it("rolls days into ISO weeks by the calendar's own numbering", () => {
    const acc = new DailyAccumulator();
    for (const date of ["2026-03-30", "2026-04-02", "2026-04-06"]) {
      acc.add({ orderDate: date, depot: "Kandy", brand: "Style", temp: "ambient", units: 1, weightKg: 1, volumeM3: 10, status: "attempted" });
    }
    acc.add({ orderDate: "2026-04-02", depot: "Kandy", brand: "Style", temp: "chilled", units: 1, weightKg: 1, volumeM3: 3, status: "deferred" });
    const weekly = weeklyFromDaily(acc.rows(), (d) => isoWeekOfDate(d));
    expect(weekly).toEqual([
      { isoYear: 2026, isoWeek: 14, depotCode: "Kandy", brand: "Style", totalVolumeM3: 23, chilledVolumeM3: 3, orderCount: 3, deferredCount: 1 },
      { isoYear: 2026, isoWeek: 15, depotCode: "Kandy", brand: "Style", totalVolumeM3: 10, chilledVolumeM3: 0, orderCount: 1, deferredCount: 0 },
    ]);
    expect(seriesFromWeekly(weekly).get("Kandy|Style")?.points).toHaveLength(2);
  });
});

describe("service observations", () => {
  it("excludes the wait for a window to open and divides handling across the orders at the stop", () => {
    // Arrived 04:48, window opens 05:00, left 05:12: service began at 05:00, 12 minutes, two orders -> 6 each.
    expect(legServiceMinutes("04:48", "05:12", "05:00", 2)).toBe(6);
    // Arrived after opening: service starts on arrival.
    expect(legServiceMinutes("05:10", "05:25", "05:00", 1)).toBe(15);
  });

  it("drops a negative or absurd span instead of averaging it in", () => {
    expect(legServiceMinutes("06:00", "05:00", "05:00", 1)).toBeNull();
    expect(legServiceMinutes("05:00", "23:00", "05:00", 1)).toBeNull();
    expect(legServiceMinutes(null, "05:00", "05:00", 1)).toBeNull();
  });

  it("reports the mean and a nearest-rank p90", () => {
    const acc = new ServiceAccumulator();
    for (let i = 1; i <= 10; i++) acc.add("Fresh", "rear_dock", "Colombo", false, i * 10);
    const [row] = acc.rows();
    expect(row).toMatchObject({ n: 10, meanActualMin: 55, p90ActualMin: 90 });
  });
});

describe("seeded randomness", () => {
  it("repeats exactly for one seed and differs for another", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
    expect(hashString("x")).toBe(hashString("x"));
  });
});

describe("the synthetic calendar", () => {
  const cal = generateSyntheticCalendar("2025-12-01", "2026-06-07");
  const at = (date: string) => cal.find((d) => d.date === date)!;

  it("matches the fixture calendar's own New Year ramp where the two overlap", () => {
    // These are the values committed in fixture/calendar.csv for the same dates.
    expect(at("2026-04-09")).toMatchObject({ festivalRamp: 0.3, isoWeek: 15 });
    expect(at("2026-04-12")).toMatchObject({ festivalRamp: 0.6 });
    expect(at("2026-04-13")).toMatchObject({ festivalRamp: 0.8, festival: "New Year", isOperating: true });
    expect(at("2026-04-14")).toMatchObject({ festivalRamp: 1, isHoliday: true, isOperating: false });
    expect(at("2026-04-18")).toMatchObject({ festivalRamp: 0.2 });
  });

  it("puts paydays on the 25th and month end, moved back off a Sunday", () => {
    expect(at("2026-03-25").isPayday).toBe(true);
    expect(at("2026-03-31").isPayday).toBe(true);
    // 25 Jan 2026 is a Sunday: payday moves to Saturday the 24th.
    expect(at("2026-01-24").isPayday).toBe(true);
    expect(at("2026-01-25").isPayday).toBe(false);
  });

  it("closes Sundays and holidays and flags the monsoon months", () => {
    expect(at("2026-03-29").isOperating).toBe(false); // Sunday
    expect(at("2026-03-28").isOperating).toBe(true); // Saturday runs
    expect(at("2026-04-20").monsoon).toBe(true);
    expect(at("2026-01-20").monsoon).toBe(false);
  });
});

// A compact stand-in for the fixture network.
const outlets: SyntheticOutlet[] = [
  { id: "OUT010", brand: "Fresh", depotCode: "Peliyagoda", districtName: "Colombo", dockType: "rear_dock", windowOpen: "05:00", windowClose: "08:30", mallWindowOpen: null, mallWindowClose: null },
  { id: "OUT040", brand: "Fresh", depotCode: "Peliyagoda", districtName: "Puttalam", dockType: "street", windowOpen: "05:00", windowClose: "09:30", mallWindowOpen: null, mallWindowClose: null },
  { id: "OUT074", brand: "Fresh", depotCode: "Peliyagoda", districtName: "Puttalam", dockType: "rear_dock", windowOpen: "05:30", windowClose: "10:00", mallWindowOpen: null, mallWindowClose: null },
  { id: "OUT020", brand: "Style", depotCode: "Peliyagoda", districtName: "Colombo", dockType: "mall_bay", windowOpen: "09:00", windowClose: "17:00", mallWindowOpen: "09:00", mallWindowClose: "11:00" },
  { id: "OUT060", brand: "Tech", depotCode: "Kandy", districtName: "Matale", dockType: "rear_dock", windowOpen: "09:00", windowClose: "16:30", mallWindowOpen: null, mallWindowClose: null },
];
const vehicles: SyntheticVehicle[] = [
  { id: "VEH101", depotCode: "Peliyagoda", temp: "reefer" },
  { id: "VEH103", depotCode: "Peliyagoda", temp: "reefer" },
  { id: "VEH102", depotCode: "Peliyagoda", temp: "ambient" },
  { id: "VEH202", depotCode: "Kandy", temp: "ambient" },
];
const travel = (district: string, depot: "Peliyagoda" | "Kandy", dep: number, inter: number): DistrictTravel => ({
  district,
  depot,
  roadClass: "urban",
  freeFlowKmh: 30,
  depotToDistrictKm: dep / 2,
  depotToDistrictFreeflowMin: dep,
  interStopKm: inter / 2,
  interStopFreeflowMin: inter,
});
const districts = new Map<string, DistrictTravel>([
  ["Colombo", travel("Colombo", "Peliyagoda", 35, 14)],
  ["Puttalam", travel("Puttalam", "Peliyagoda", 135, 18)],
  ["Matale", travel("Matale", "Kandy", 60, 16)],
]);
const allowance = new Map<string, number>();
for (const brand of ["Fresh", "Style", "Tech"] as const) {
  for (const dock of ["rear_dock", "street", "mall_bay"] as const) allowance.set(allowanceKey(brand, dock), 15 + (brand === "Fresh" ? 0 : 20));
}

const calendar = generateSyntheticCalendar("2024-10-01", "2026-06-07").map(toSignalDay);

describe("the synthetic daily demand", () => {
  const run = () => generateSyntheticDaily(outlets, calendar, "2024-10-07", "2026-03-29");

  it("is identical on every run, and never asks Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    const first = run();
    const second = run();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(1000);
  });

  it("covers eighteen months of operating days only, with chilled demand for Fresh alone", () => {
    const rows = run();
    expect(rows.every((r) => r.date >= "2024-10-07" && r.date <= "2026-03-29")).toBe(true);
    expect(rows.some((r) => r.date === "2026-03-29")).toBe(false); // a Sunday
    expect(rows.filter((r) => r.temp === "chilled").every((r) => r.brand === "Fresh")).toBe(true);
    // Kandy has no Fresh outlet in this network, so it has no chilled history to invent.
    expect(rows.filter((r) => r.depotCode === "Kandy" && r.temp === "chilled")).toHaveLength(0);
  });

  it("applies the calendar: demand is higher on festival-ramp and payday days", () => {
    const rows = run();
    const byDate = new Map<string, number>();
    for (const r of rows) if (r.brand === "Fresh" && r.temp === "chilled") byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.volumeM3);
    const days = calendar.filter((d) => byDate.has(d.date));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const plain = mean(days.filter((d) => d.festivalRamp === 0 && !d.isPayday).map((d) => byDate.get(d.date)!));
    const ramp = mean(days.filter((d) => d.festivalRamp >= 0.5 && !d.isPayday).map((d) => byDate.get(d.date)!));
    const payday = mean(days.filter((d) => d.isPayday && d.festivalRamp === 0).map((d) => byDate.get(d.date)!));
    expect(ramp / plain).toBeGreaterThan(1.1);
    expect(payday / plain).toBeGreaterThan(1.03);
  });

  it("feeds weekly series the forecast can use", () => {
    const weekly = weeklyFromDaily(run(), (d) => isoWeekOfDate(d));
    const series = seriesFromWeekly(weekly);
    expect([...series.keys()].sort()).toEqual(["Kandy|Tech", "Peliyagoda|Fresh", "Peliyagoda|Style"]);
    expect(series.get("Peliyagoda|Fresh")!.points.length).toBeGreaterThanOrEqual(75);
  });
});

describe("the synthetic legs", () => {
  const legs = () =>
    generateSyntheticLegs({ outlets, vehicles, districts, allowance, calendar, from: "2026-02-02", to: "2026-03-28" });

  it("is identical on every run and labelled synthetic in every id", () => {
    const a = legs();
    expect(legs()).toEqual(a);
    expect(a.length).toBeGreaterThan(100);
    expect(a.every((l) => l.id.startsWith("SYN-") && l.routeId.startsWith("SYN-"))).toBe(true);
  });

  it("has believable planned vs actual times and runs no vehicle more than twice a day", () => {
    const a = legs();
    expect(a.every((l) => l.arrivalTime && l.actualDepart && l.leaveOutletTime)).toBe(true);
    // Arrival follows departure; leaving follows arriving.
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    expect(a.every((l) => toMin(l.arrivalTime!) > toMin(l.actualDepart!) && toMin(l.leaveOutletTime!) > toMin(l.arrivalTime!))).toBe(true);

    const perVehicleDay = new Map<string, Set<string>>();
    for (const l of a) {
      const key = `${l.date}|${l.vehicleId}`;
      perVehicleDay.set(key, (perVehicleDay.get(key) ?? new Set()).add(l.routeId));
    }
    expect(Math.max(...[...perVehicleDay.values()].map((s) => s.size))).toBeLessThanOrEqual(2);

    // Some stops run late and most do not: an on-time report has something to say either way.
    const closeOf = new Map(outlets.map((o) => [o.id, o.mallWindowClose ?? o.windowClose]));
    const late = a.filter((l) => toMin(l.arrivalTime!) > toMin(closeOf.get(l.outletId)!)).length;
    expect(late).toBeGreaterThan(0);
    expect(late / a.length).toBeLessThan(0.25);
  });

  it("sends Fresh to a reefer when the depot has one", () => {
    const fresh = legs().filter((l) => l.brand === "Fresh");
    expect(fresh.every((l) => ["VEH101", "VEH103"].includes(l.vehicleId))).toBe(true);
  });
});
