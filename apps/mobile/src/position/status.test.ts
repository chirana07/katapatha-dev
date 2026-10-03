import { describe, expect, it } from "vitest";
import { deriveStatus, type StatusInput } from "./status";

const base: StatusInput = {
  enabled: true,
  permission: "granted",
  hasVehicle: true,
  problem: null,
  hasReported: false,
  fixMissing: false,
};

const status = (over: Partial<StatusInput>) => deriveStatus({ ...base, ...over }).status;

describe("deriveStatus", () => {
  it("is off when the driver has not turned it on", () => {
    expect(status({ enabled: false, permission: "undetermined" })).toBe("off");
  });
  it("a denied permission wins over everything, whether or not sharing is on", () => {
    expect(status({ permission: "denied" })).toBe("denied");
    expect(status({ enabled: false, permission: "denied" })).toBe("denied");
    expect(status({ permission: "denied", problem: "clock" })).toBe("denied");
  });
  it("names the phone clock", () => {
    expect(status({ problem: "clock" })).toBe("clock-wrong");
  });
  it("waits for a vehicle, never reporting without one", () => {
    expect(deriveStatus({ ...base, hasVehicle: false, hasReported: true })).toEqual({
      status: "waiting",
      detail: "no-vehicle",
    });
    expect(deriveStatus({ ...base, problem: "no-vehicle" }).detail).toBe("no-vehicle");
  });
  it("an ended session reads as offline, with the reason", () => {
    expect(deriveStatus({ ...base, problem: "auth" })).toEqual({
      status: "offline",
      detail: "session-ended",
    });
  });
  it("offline is offline", () => {
    expect(deriveStatus({ ...base, problem: "offline", hasReported: true })).toEqual({
      status: "offline",
      detail: null,
    });
  });
  it("reports once something was confirmed, and waits before that", () => {
    expect(status({ hasReported: true })).toBe("reporting");
    expect(deriveStatus(base)).toEqual({ status: "waiting", detail: null });
    expect(deriveStatus({ ...base, fixMissing: true }).detail).toBe("no-fix");
  });
});
