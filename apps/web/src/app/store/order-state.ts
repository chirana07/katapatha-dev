import type { components } from "@katapatha/contracts/types";

type Order = components["schemas"]["Order"];

export function storeState(order: Pick<Order, "status" | "storeState">): string {
  if (order.storeState) return order.storeState;
  if (["DRAFT", "PLACED", "QUEUED"].includes(order.status)) return "queued";
  if (["PLANNED", "LOADED"].includes(order.status)) return "planned";
  if (order.status === "IN_TRANSIT") return "on_the_way";
  if (["DELIVERED", "PART_DELIVERED"].includes(order.status)) return "delivered";
  return order.status.toLowerCase();
}

export function needsAttention(state: string): boolean {
  return ["deferred", "failed", "cancelled"].includes(state);
}

export function storeStateLabel(state: string): string {
  const words = state.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function receivingWindowLabel(
  order: Pick<Order, "windowOpen" | "windowClose">,
): string {
  return order.windowOpen && order.windowClose
    ? `${order.windowOpen}–${order.windowClose}`
    : "Awaiting plan";
}
