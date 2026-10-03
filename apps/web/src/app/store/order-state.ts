import type { components } from "@katapatha/contracts/types";
import type { Tone } from "@/components/ui/status-pill";

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

/**
 * Colour for the state pill. Deferred is a warning, not an error: the order is
 * still coming, the store just has a new day to plan around. Failed is the one
 * outcome that is plainly bad.
 */
export function storeStateTone(state: string): Tone {
  switch (state) {
    case "delivered":
      return "good";
    case "on_the_way":
      return "info";
    case "deferred":
      return "warn";
    case "failed":
      return "bad";
    default:
      return "neutral";
  }
}

export function receivingWindowLabel(
  order: Pick<Order, "windowOpen" | "windowClose">,
): string {
  return order.windowOpen && order.windowClose
    ? `${order.windowOpen}–${order.windowClose}`
    : "Awaiting plan";
}

/** "Ambient" or "Chilled", as the store manager would say it. */
export function goodsLabel(temp: string): string {
  return temp === "chilled" ? "Chilled" : "Ambient";
}

const PROGRESS = [
  { key: "queued", label: "Queued" },
  { key: "planned", label: "Planned" },
  { key: "on_the_way", label: "On the way" },
  { key: "delivered", label: "Delivered" },
] as const;

/**
 * The four steps an order passes through, for the tracker on the order page.
 * Deferred, cancelled and failed orders have left that path, so they return
 * null and the page explains where the order went instead of drawing a bar
 * that stops somewhere arbitrary.
 */
export function progressSteps(state: string): { label: string; state: "done" | "current" | "todo" }[] | null {
  const index = PROGRESS.findIndex((step) => step.key === state);
  if (index === -1) return null;
  return PROGRESS.map((step, i) => ({
    label: step.label,
    state: i < index ? "done" : i === index ? "current" : "todo",
  }));
}
