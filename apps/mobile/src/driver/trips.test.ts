import { describe, it, expect } from "vitest";
import { activeTripIndex, tripProgress, tripsOf } from "./trips";
import type { StopStatus } from "./stop-state";

function stop(id: string, tripId: string, tripNo: number, status: StopStatus) {
  return { id, tripId, tripNo, projection: { status } };
}

const STOPS = [
  stop("a1", "t1", 1, "DONE"),
  stop("a2", "t1", 1, "FAILED"),
  stop("b1", "t2", 2, "UNLOADING"),
  stop("b2", "t2", 2, "PENDING"),
  stop("c1", "t3", 3, "PENDING"),
];

describe("tripsOf", () => {
  it("groups the flat list by trip, in trip order, keeping stop order", () => {
    const trips = tripsOf(STOPS);
    expect(trips.map((trip) => [trip.tripId, trip.tripNo, trip.stops.map((s) => s.id)])).toEqual([
      ["t1", 1, ["a1", "a2"]],
      ["t2", 2, ["b1", "b2"]],
      ["t3", 3, ["c1"]],
    ]);
  });

  it("orders by trip number even when the input is not", () => {
    const trips = tripsOf([stop("c1", "t3", 3, "PENDING"), stop("a1", "t1", 1, "DONE")]);
    expect(trips.map((trip) => trip.tripNo)).toEqual([1, 3]);
  });

  it("is empty for no stops", () => {
    expect(tripsOf([])).toEqual([]);
  });
});

describe("activeTripIndex", () => {
  it("is the trip holding the next unfinished stop", () => {
    expect(activeTripIndex(tripsOf(STOPS))).toBe(1);
  });

  it("moves on once a trip's stops are all closed", () => {
    const stops = STOPS.map((s) => (s.tripId === "t2" ? { ...s, projection: { status: "DONE" as const } } : s));
    expect(activeTripIndex(tripsOf(stops))).toBe(2);
  });

  it("is the last trip when everything is closed", () => {
    const stops = STOPS.map((s) => ({ ...s, projection: { status: "SKIPPED" as const } }));
    expect(activeTripIndex(tripsOf(stops))).toBe(2);
  });

  it("is 0 for no trips, so trips[index] is simply undefined", () => {
    expect(activeTripIndex([])).toBe(0);
  });
});

describe("tripProgress", () => {
  it("counts done, DONE/FAILED/SKIPPED alike, and rounds the percent", () => {
    const [t1, t2, t3] = tripsOf(STOPS);
    expect(tripProgress(t1)).toEqual({ done: 2, total: 2, percent: 100 });
    expect(tripProgress(t2)).toEqual({ done: 0, total: 2, percent: 0 });
    expect(tripProgress(t3)).toEqual({ done: 0, total: 1, percent: 0 });
    const third = tripsOf([
      stop("1", "t", 1, "DONE"),
      stop("2", "t", 1, "PENDING"),
      stop("3", "t", 1, "PENDING"),
    ])[0];
    expect(tripProgress(third)).toEqual({ done: 1, total: 3, percent: 33 });
  });

  it("does not divide by zero", () => {
    expect(tripProgress({ tripId: "t", tripNo: 1, stops: [] })).toEqual({ done: 0, total: 0, percent: 0 });
  });
});
