import type { Problem } from "./reporter";

/** What the hook reports. A closed union, so a new wording is a compile error. */
export type PositionStatus =
  | "off"
  | "waiting"
  | "reporting"
  | "denied"
  | "clock-wrong"
  | "offline";

export type PositionPermission = "granted" | "denied" | "undetermined";

/** Why `waiting`/`offline` is what it is, for the one line of copy that explains it. */
export type StatusDetail =
  | "no-vehicle"
  | "no-fix"
  | "session-ended"
  | "rejected"
  | null;

export interface StatusInput {
  enabled: boolean;
  permission: PositionPermission;
  /** A vehicle is claimed (the run snapshot has a vehicleId). */
  hasVehicle: boolean;
  problem: Problem | null;
  /** The newest confirmed fix, if any. */
  hasReported: boolean;
  /** The last attempt to take a fix produced nothing. */
  fixMissing: boolean;
}

/**
 * One status from the facts. Order is the order a driver can act in: permission
 * first (nothing else matters without it), then the clock, then the claim, then
 * the network.
 */
export function deriveStatus(input: StatusInput): { status: PositionStatus; detail: StatusDetail } {
  if (input.permission === "denied") return { status: "denied", detail: null };
  if (!input.enabled) return { status: "off", detail: null };
  if (input.problem === "clock") return { status: "clock-wrong", detail: null };
  if (!input.hasVehicle || input.problem === "no-vehicle") {
    return { status: "waiting", detail: "no-vehicle" };
  }
  if (input.problem === "auth") return { status: "offline", detail: "session-ended" };
  if (input.problem === "offline") return { status: "offline", detail: null };
  if (input.problem === "rejected") return { status: "waiting", detail: "rejected" };
  if (input.hasReported) return { status: "reporting", detail: null };
  return { status: "waiting", detail: input.fixMissing ? "no-fix" : null };
}
