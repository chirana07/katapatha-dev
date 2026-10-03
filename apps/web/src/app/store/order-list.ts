import { storeState } from "./order-state";

/**
 * The filters over the order list. "Open" is everything still on its way to
 * the outlet; deferred and cancelled get their own tabs because they are the
 * two outcomes a store manager has to act on or plan around.
 */
export const ORDER_TABS = [
  { value: "all", label: "All orders" },
  { value: "open", label: "Open" },
  { value: "delivered", label: "Delivered" },
  { value: "deferred", label: "Deferred" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export type OrderTab = (typeof ORDER_TABS)[number]["value"];

export function parseTab(value: string | string[] | undefined): OrderTab {
  const first = Array.isArray(value) ? value[0] : value;
  return ORDER_TABS.find((tab) => tab.value === first)?.value ?? "all";
}

const OPEN_STATES = new Set(["queued", "planned", "on_the_way"]);

export function matchesTab(state: string, tab: OrderTab): boolean {
  if (tab === "all") return true;
  if (tab === "open") return OPEN_STATES.has(state);
  return state === tab;
}

export function matchesQuery(ref: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || ref.toLowerCase().includes(needle);
}

/** Newest requested day first; within a day, the later reference first. */
export function newestFirst<T extends { requestedDate: string; ref: string }>(orders: readonly T[]): T[] {
  return [...orders].sort(
    (a, b) => b.requestedDate.localeCompare(a.requestedDate) || b.ref.localeCompare(a.ref),
  );
}

export function tabCounts(orders: readonly { status: string; storeState?: string }[]): Record<OrderTab, number> {
  const counts = { all: 0, open: 0, delivered: 0, deferred: 0, cancelled: 0 } as Record<OrderTab, number>;
  for (const order of orders) {
    const state = storeState(order as Parameters<typeof storeState>[0]);
    for (const tab of ORDER_TABS) if (matchesTab(state, tab.value)) counts[tab.value] += 1;
  }
  return counts;
}

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  /** 1-based, for "1–10 of 14". Both 0 when there is nothing. */
  from: number;
  to: number;
  total: number;
}

/** A page number from `?page=`, clamped into range rather than trusted. */
export function paginate<T>(items: readonly T[], requested: string | string[] | undefined, size: number): Page<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const first = Array.isArray(requested) ? requested[0] : requested;
  const asked = Number.parseInt(first ?? "1", 10);
  const page = Number.isFinite(asked) ? Math.min(pages, Math.max(1, asked)) : 1;
  const start = (page - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, page, pages, from: total === 0 ? 0 : start + 1, to: start + slice.length, total };
}
