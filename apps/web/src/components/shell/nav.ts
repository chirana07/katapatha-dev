import type { Role } from "@katapatha/core/domain/roles";

/**
 * What each role's rail contains.
 *
 * This is navigation *content*, not a route registry: the App Router still
 * discovers pages from the filesystem, and a page that is not listed here
 * still works. CONVENTIONS.md rule 2 forbids a central list everyone appends
 * to — this is one file owned by the shell, describing one role's menu each,
 * which is the thing the designs actually specify (D-02 shows seven items for
 * the dispatcher, L-02 three for the loader, S-02 five for the store).
 *
 * `scope` is the line under the role name in the yellow chip. It is the single
 * most load-bearing string in the shell: a dispatcher is scoped to one depot, a
 * loader to one dock, a store manager to one outlet, and every authorization
 * predicate in the API enforces exactly that. Showing it constantly is how the
 * operator knows which records they are about to act on.
 */

export interface NavItem {
  label: string;
  href: string;
  /** Marks the item current when the path is this item's href or below it. */
  match?: "exact" | "prefix";
}

export interface RoleNav {
  /** The name in the yellow chip. */
  title: string;
  home: string;
  items: NavItem[];
  /** Shortcuts under a divider. Dispatcher only, per the designs. */
  quickActions?: NavItem[];
}

export const NAV: Record<Role, RoleNav> = {
  DISPATCHER: {
    title: "Dispatcher",
    home: "/dispatcher",
    items: [
      { label: "Dashboard", href: "/dispatcher", match: "exact" },
      { label: "Orders", href: "/dispatcher/orders" },
      { label: "Planning", href: "/dispatcher/planning" },
      { label: "Vehicles", href: "/dispatcher/vehicles" },
      { label: "Map", href: "/dispatcher/map" },
      { label: "Exceptions", href: "/dispatcher/exceptions" },
      { label: "Reports", href: "/dispatcher/reports" },
    ],
    quickActions: [
      { label: "Generate plan", href: "/dispatcher/planning" },
      { label: "Import orders", href: "/dispatcher/orders/import" },
      { label: "Export plan", href: "/dispatcher/planning/export" },
    ],
  },
  LOADER: {
    title: "Loader",
    home: "/loader",
    items: [
      { label: "Dock", href: "/loader", match: "exact" },
      { label: "Loading progress", href: "/loader/progress" },
      { label: "Reports", href: "/loader/reports" },
    ],
  },
  STORE_MANAGER: {
    title: "Store Manager",
    home: "/store",
    items: [
      { label: "Today", href: "/store", match: "exact" },
      { label: "My orders", href: "/store/orders" },
      { label: "Place an order", href: "/store/new" },
      { label: "Delivery history", href: "/store/history" },
      { label: "Report an issue", href: "/store/issues/new" },
    ],
  },
  // The driver has no rail. DESIGN.md: phone is "one column, no page-wide
  // horizontal scroll, compact header or bottom navigation", and the designs
  // give the driver a header plus a pinned thumb bar instead.
  DRIVER: {
    title: "Driver",
    home: "/driver",
    items: [],
  },
};

export function isCurrent(item: NavItem, pathname: string): boolean {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
