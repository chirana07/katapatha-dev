import type { Outlet, Role, User, Vehicle } from "@prisma/client";
import { toMin } from "@katapatha/core/domain/time";

/**
 * The admin's records, shaped for the wire, and the rules they must satisfy
 * that a JSON schema cannot say. Pure, so the rules are tested without a
 * database; routes/admin.ts does the reads and writes.
 */

/** Roles that work at one depot. A store manager works at one outlet; an admin at neither. */
export const DEPOT_ROLES: readonly Role[] = ["DISPATCHER", "LOADER", "DRIVER"];

export function toAdminUser(user: User, lastSignInAt: Date | null) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    depotCode: user.depotCode,
    outletId: user.outletId,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    lastSignInAt: lastSignInAt ? lastSignInAt.toISOString() : null,
  };
}

/** What the decision log keeps of an account. Never the password hash. */
export function userSnapshot(user: Pick<User, "email" | "name" | "role" | "depotCode" | "outletId" | "active">) {
  return {
    email: user.email,
    name: user.name,
    role: user.role,
    depotCode: user.depotCode,
    outletId: user.outletId,
    active: user.active,
  };
}

/**
 * The scope a role needs, and nothing else: a dispatcher bound to an outlet
 * would be a record no authorization predicate expects. Returns the binding to
 * store, or what is wrong with it. Existence of the depot or outlet is the
 * route's to check.
 */
export function scopeFor(
  role: Role,
  depotCode: string | null | undefined,
  outletId: string | null | undefined,
): { depotCode: string | null; outletId: string | null } | { error: string } {
  if (DEPOT_ROLES.includes(role)) {
    if (!depotCode) return { error: "A dispatcher, loader or driver needs a depot." };
    return { depotCode, outletId: null };
  }
  if (role === "STORE_MANAGER") {
    if (!outletId) return { error: "A store manager needs an outlet." };
    return { depotCode: null, outletId };
  }
  return { depotCode: null, outletId: null };
}

export type AdminOutletRow = Outlet & { managers: number };

export function toAdminOutlet(outlet: Outlet, managers: number) {
  return {
    id: outlet.id,
    displayName: outlet.displayName,
    brand: outlet.brand,
    districtName: outlet.districtName,
    depotCode: outlet.depotCode,
    dockType: outlet.dockType,
    parkingConstraint: outlet.parkingConstraint,
    windowOpen: outlet.windowOpen,
    windowClose: outlet.windowClose,
    mallWindowOpen: outlet.mallWindowOpen,
    mallWindowClose: outlet.mallWindowClose,
    lat: outlet.lat,
    lng: outlet.lng,
    geoSource: outlet.geoSource,
    managers,
  };
}

export function outletSnapshot(outlet: Outlet) {
  return {
    displayName: outlet.displayName,
    brand: outlet.brand,
    districtName: outlet.districtName,
    depotCode: outlet.depotCode,
    dockType: outlet.dockType,
    parkingConstraint: outlet.parkingConstraint,
    windowOpen: outlet.windowOpen,
    windowClose: outlet.windowClose,
    mallWindowOpen: outlet.mallWindowOpen,
    mallWindowClose: outlet.mallWindowClose,
  };
}

export interface OutletWindows {
  dockType: Outlet["dockType"];
  windowOpen: string;
  windowClose: string;
  mallWindowOpen: string | null;
  mallWindowClose: string | null;
}

/**
 * The receiving windows as the planner reads them: open before close, and a
 * mall window given whole or not at all. A mall bay without a mall window
 * would be planned as if the mall never closed its dock.
 */
export function windowProblem(w: OutletWindows): string | null {
  if (toMin(w.windowOpen) >= toMin(w.windowClose)) {
    return "The receiving window must open before it closes.";
  }
  const mallGiven = [w.mallWindowOpen, w.mallWindowClose].filter((t) => t !== null).length;
  if (mallGiven === 1) return "Give both mall-window times, or neither.";
  if (w.mallWindowOpen && w.mallWindowClose && toMin(w.mallWindowOpen) >= toMin(w.mallWindowClose)) {
    return "The mall window must open before it closes.";
  }
  if (w.dockType === "mall_bay" && mallGiven === 0) return "A mall bay needs the mall's access window.";
  return null;
}

export function toAdminVehicle(vehicle: Vehicle, trips: number) {
  return {
    id: vehicle.id,
    type: vehicle.type,
    temp: vehicle.temp,
    weightCapKg: vehicle.weightCapKg,
    volumeCapM3: vehicle.volumeCapM3,
    fuelType: vehicle.fuelType,
    kmPerL: vehicle.kmPerL,
    weeklyFuelQuotaL: vehicle.weeklyFuelQuotaL,
    depotCode: vehicle.depotCode,
    trips,
  };
}

export function vehicleSnapshot(vehicle: Vehicle) {
  const { id: _id, ...rest } = vehicle;
  return rest;
}

/** Only the keys whose values differ, for a decision-log row with no phantom changes. */
export function changedKeys(before: Record<string, unknown>, data: Record<string, unknown>): string[] {
  return Object.keys(data).filter((key) => data[key] !== undefined && data[key] !== before[key]);
}
