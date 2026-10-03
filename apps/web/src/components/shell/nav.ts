import type { Role } from "@katapatha/core/domain/roles";
import type { IconKind } from "./nav-icon";

/**
 * What each role's rail contains.
 *
 * This is navigation *content*, not a route registry: the App Router still
 * discovers pages from the filesystem, and a page that is not listed here still
 * works. CONVENTIONS.md rule 2 forbids a central list everyone appends to —
 * this is one file describing one menu per role, which is what the designs
 * specify (D-02 shows seven items for the dispatcher, L-02 three for the
 * loader, S-02 five for the store).
 *
 * `match` is a regex because a section stays current while you are inside it:
 * /loader/trips/{id} is still "Dock", and /store/orders/{id} is still
 * "My orders". Carried over from the per-role sidebars this replaced.
 *
 * `scope` — the line under the role name in the chip — is the most load-bearing
 * string in the shell. A dispatcher is scoped to one depot, a loader to one
 * dock, a store manager to one outlet, and every authorization predicate in the
 * API enforces exactly that. Showing it constantly is how the operator knows
 * which records they are about to act on.
 */

export interface NavItem {
  label: string;
  href: string;
  icon: IconKind;
  /** Current while the path matches. Defaults to an exact match on href. */
  match?: RegExp;
}

export interface RoleNav {
  /** The name in the chip. */
  title: string;
  home: string;
  /** Fallback avatar initials when the session has no name. */
  fallbackInitials: string;
  items: NavItem[];
}

export const NAV: Record<Role, RoleNav> = {
  DISPATCHER: {
    title: "Dispatcher",
    home: "/dispatcher",
    fallbackInitials: "DP",
    items: [
      { label: "Dashboard", href: "/dispatcher", icon: "dashboard", match: /^\/dispatcher$/ },
      { label: "Orders", href: "/dispatcher/orders", icon: "orders", match: /^\/dispatcher\/orders/ },
      {
        label: "Planning",
        href: "/dispatcher/planning",
        icon: "planning",
        // The plan board lives under /dispatcher/plans/{id}; it is Planning.
        match: /^\/dispatcher\/(planning|plans)/,
      },
      { label: "Vehicles", href: "/dispatcher/vehicles", icon: "vehicles", match: /^\/dispatcher\/vehicles/ },
      { label: "Products", href: "/dispatcher/products", icon: "products", match: /^\/dispatcher\/products/ },
      { label: "Map", href: "/dispatcher/map", icon: "map", match: /^\/dispatcher\/map/ },
      { label: "Exceptions", href: "/dispatcher/exceptions", icon: "exceptions", match: /^\/dispatcher\/exceptions/ },
      { label: "Reports", href: "/dispatcher/reports", icon: "reports", match: /^\/dispatcher\/reports/ },
    ],
  },
  LOADER: {
    title: "Loader",
    home: "/loader",
    fallbackInitials: "LD",
    items: [
      { label: "Dock", href: "/loader", icon: "dock", match: /^\/loader(\/trips\/.*)?$/ },
      { label: "Loading progress", href: "/loader/progress", icon: "progress", match: /^\/loader\/progress/ },
      { label: "Reports", href: "/loader/reports", icon: "reports", match: /^\/loader\/reports/ },
    ],
  },
  STORE_MANAGER: {
    title: "Store manager",
    home: "/store",
    fallbackInitials: "SM",
    items: [
      // Today (S-02) and My orders (S-05) are separate screens in the design, so
      // /store is Today and the order list lives at /store/orders.
      { label: "Today", href: "/store", icon: "dashboard", match: /^\/store$/ },
      { label: "My orders", href: "/store/orders", icon: "orders", match: /^\/store\/orders/ },
      { label: "Place an order", href: "/store/new", icon: "place", match: /^\/store\/new/ },
      { label: "Delivery history", href: "/store/history", icon: "history", match: /^\/store\/history/ },
      { label: "Report an issue", href: "/store/issues", icon: "issue", match: /^\/store\/issues/ },
    ],
  },
  // The driver has no rail. DESIGN.md: phone is "one column, no page-wide
  // horizontal scroll, compact header or bottom navigation", and the designs
  // give the driver a header plus a pinned thumb bar instead.
  DRIVER: {
    title: "Driver",
    home: "/driver",
    fallbackInitials: "DR",
    items: [],
  },
};

export function isCurrent(item: NavItem, pathname: string): boolean {
  return item.match ? item.match.test(pathname) : pathname === item.href;
}

/** Up to two initials for the rail's avatar. */
export function initialsOf(name: string | null | undefined, fallback: string): string {
  if (!name) return fallback;
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return initials || fallback;
}
