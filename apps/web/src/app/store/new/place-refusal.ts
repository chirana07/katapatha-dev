import type { Failure } from "@/lib/failures";
import { TEMP_LABEL, isTemp } from "@/lib/temperature";

export interface ApiRefusal {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

const GOODS = TEMP_LABEL;

/**
 * What a 422 from `POST /orders` means to the person holding the basket.
 *
 * Every one of these is the API refusing before it wrote anything, so the
 * outcome is `failed`, never `unknown`: nothing was placed and it is safe to
 * fix the basket and try again. Anything not listed (a closed day, a bad date)
 * returns null and falls through to the generic write failure.
 */
export function placeRefusal(refusal: ApiRefusal | undefined): Failure | null {
  if (!refusal?.code) return null;
  const details = refusal.details ?? {};

  switch (refusal.code) {
    case "ORDER_TOO_LARGE": {
      const temp = isTemp(details.tempRequirement) ? details.tempRequirement : null;
      const max = typeof details.maxUnitsPerOrder === "number" ? details.maxUnitsPerOrder : null;
      const units = typeof details.units === "number" ? details.units : null;
      if (temp && max === 0) {
        return {
          title: `${GOODS[temp]} goods can't be delivered here`,
          detail: "No vehicle at your depot can carry them to this outlet. Contact your dispatcher.",
          outcome: "failed",
        };
      }
      if (temp && max != null && max > 0) {
        return {
          title: "That order is too large",
          detail:
            `One vehicle can carry about ${max.toLocaleString("en-GB")} units of these ${temp} products` +
            `${units != null ? `, and you chose ${units.toLocaleString("en-GB")}` : ""}. ` +
            "Lower the quantities and place the rest as another order.",
          outcome: "failed",
        };
      }
      return { title: "That order is too large", detail: refusal.message ?? "Lower the quantities and place the rest as another order.", outcome: "failed" };
    }
    case "PRODUCT_NOT_FOUND":
      return {
        title: "A product is no longer in the catalogue",
        detail: "Reload the page to see the current list. What you chose is kept for the products that are still there.",
        outcome: "failed",
      };
    case "PRODUCT_INACTIVE":
      return {
        title: "A product is no longer offered",
        detail: `${refusal.message ?? "One of the products can't be ordered any more."} Reload the page to see the current list; your other choices are kept.`,
        outcome: "failed",
      };
    case "PRODUCT_NOT_AVAILABLE_FOR_BRAND":
      return {
        title: "A product is not for your outlet",
        detail: `${refusal.message ?? "One of the products is not offered to your brand."} Take it off the order and try again.`,
        outcome: "failed",
      };
    default:
      return null;
  }
}
