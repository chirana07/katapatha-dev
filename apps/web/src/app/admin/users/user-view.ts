import type { components } from "@katapatha/contracts/types";
import { ROLES, isRole, type Role } from "./user-form";

export type AdminUser = components["schemas"]["AdminUser"];
type AdminOutlet = components["schemas"]["AdminOutlet"];

export type StatusFilter = "all" | "active" | "disabled";

export interface UserFilters {
  role: Role | null;
  status: StatusFilter;
  q: string;
}

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The page's filters from its search params; anything unrecognised means "no filter". */
export function parseFilters(query: Query): UserFilters {
  const role = first(query.role);
  const status = first(query.status);
  return {
    role: isRole(role) ? role : null,
    status: status === "active" || status === "disabled" ? status : "all",
    q: first(query.q).trim().slice(0, 80),
  };
}

/**
 * The accounts narrowed by the filters. `ignore` lets the tab counts apply
 * every filter except the role itself, so "Drivers (6)" still says 6 while
 * the Loaders tab is open.
 */
export function filterUsers(users: readonly AdminUser[], filters: UserFilters, ignore?: "role"): AdminUser[] {
  const needle = filters.q.toLowerCase();
  return users.filter((user) => {
    if (ignore !== "role" && filters.role && user.role !== filters.role) return false;
    if (filters.status === "active" && !user.active) return false;
    if (filters.status === "disabled" && user.active) return false;
    return needle === "" || user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle);
  });
}

export function roleCounts(users: readonly AdminUser[], filters: UserFilters): Record<"all" | Role, number> {
  const rest = filterUsers(users, filters, "role");
  const counts = { all: rest.length } as Record<"all" | Role, number>;
  for (const role of ROLES) counts[role] = rest.filter((user) => user.role === role).length;
  return counts;
}

/**
 * Where an account works, in words. An outlet's id is what the store and the
 * dispatcher both quote, so it leads; its name follows when it has one. A
 * binding that points at nothing known is shown as is rather than hidden, so
 * a broken account is visible.
 */
export function scopeText(user: AdminUser, outlets: ReadonlyMap<string, Pick<AdminOutlet, "displayName">>): string {
  if (user.role === "ADMIN") return "All of Waypoint";
  if (user.outletId) {
    const name = outlets.get(user.outletId)?.displayName;
    return name ? `${user.outletId} · ${name}` : user.outletId;
  }
  if (user.depotCode) return user.depotCode;
  return "Not assigned";
}

export const USERS_PATH = "/admin/users";

/** A link back to the page keeping the filters, with the dialog (if any) the link opens. */
export function usersHref(filters: UserFilters, extra?: { edit?: string; disable?: string; add?: boolean }): string {
  const params = new URLSearchParams();
  if (filters.role) params.set("role", filters.role);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (extra?.edit) params.set("edit", extra.edit);
  if (extra?.disable) params.set("disable", extra.disable);
  if (extra?.add) params.set("add", "1");
  const qs = params.toString();
  return qs ? `${USERS_PATH}?${qs}` : USERS_PATH;
}
