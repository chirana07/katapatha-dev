import type { components } from "@katapatha/contracts/types";
import type { Tone } from "@/components/ui/status-pill";

type OrderStatus = components["schemas"]["OrderStatus"];
type Order = components["schemas"]["Order"];

/**
 * How an order's status reads on the dispatcher's screens.
 *
 * The labels are the real status, not a friendlier one: a PLANNED order is
 * "Planned" because publication is what makes it so, and the dashboard and the
 * orders list must say the same word for it. One table, so they cannot drift.
 */
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PLACED: { label: "Placed", tone: "info" },
  QUEUED: { label: "Queued", tone: "info" },
  PLANNED: { label: "Planned", tone: "good" },
  LOADED: { label: "Loaded", tone: "good" },
  IN_TRANSIT: { label: "On the way", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "good" },
  PART_DELIVERED: { label: "Part delivered", tone: "warn" },
  FAILED: { label: "Failed", tone: "bad" },
  DEFERRED: { label: "Deferred", tone: "bad" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/**
 * The tabs on the orders list. Each is a set of statuses, so the counts on the
 * tabs and the rows under them come from the same predicate.
 *
 * "attention" overlaps "deferred" on purpose: it is the dispatcher's question
 * ("what is going wrong today?"), not a state an order is in.
 */
export type OrderGroup = "waiting" | "allocated" | "deferred" | "attention" | "completed";

const GROUPS: Record<OrderGroup, ReadonlySet<OrderStatus>> = {
  waiting: new Set(["DRAFT", "PLACED", "QUEUED"]),
  allocated: new Set(["PLANNED", "LOADED", "IN_TRANSIT"]),
  deferred: new Set(["DEFERRED"]),
  attention: new Set(["DEFERRED", "FAILED", "PART_DELIVERED"]),
  completed: new Set(["DELIVERED", "PART_DELIVERED"]),
};

export const ORDER_GROUPS = Object.keys(GROUPS) as OrderGroup[];

export function isOrderGroup(value: unknown): value is OrderGroup {
  // Own keys only: `"constructor" in GROUPS` is true, and this comes from the URL.
  return typeof value === "string" && (ORDER_GROUPS as string[]).includes(value);
}

export function inGroup(status: OrderStatus, group: OrderGroup): boolean {
  return GROUPS[group].has(status);
}

export function groupCounts(orders: readonly Pick<Order, "status">[]): Record<OrderGroup, number> {
  const counts = { waiting: 0, allocated: 0, deferred: 0, attention: 0, completed: 0 };
  for (const order of orders) {
    for (const group of ORDER_GROUPS) if (inGroup(order.status, group)) counts[group] += 1;
  }
  return counts;
}

export interface OrderFilter {
  group?: OrderGroup;
  brand?: Order["brand"];
  temp?: Order["tempRequirement"];
  /** Matches the order ref, the outlet id and the district, case-insensitively. */
  q?: string;
}

export function filterOrders<T extends Pick<Order, "status" | "brand" | "tempRequirement" | "ref" | "outletId" | "districtName">>(
  orders: readonly T[],
  filter: OrderFilter,
): T[] {
  const needle = filter.q?.trim().toLowerCase();
  return orders.filter((order) => {
    if (filter.group && !inGroup(order.status, filter.group)) return false;
    if (filter.brand && order.brand !== filter.brand) return false;
    if (filter.temp && order.tempRequirement !== filter.temp) return false;
    if (needle) {
      const haystack = `${order.ref} ${order.outletId} ${order.districtName ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function sumVolume(orders: readonly Pick<Order, "volumeM3">[]): number {
  return orders.reduce((total, order) => total + (order.volumeM3 ?? 0), 0);
}

export function sumWeight(orders: readonly Pick<Order, "weightKg">[]): number {
  return orders.reduce((total, order) => total + (order.weightKg ?? 0), 0);
}

export function isBrand(value: unknown): value is Order["brand"] {
  return value === "Fresh" || value === "Style" || value === "Tech";
}

export function isTemp(value: unknown): value is Order["tempRequirement"] {
  return value === "chilled" || value === "ambient";
}
