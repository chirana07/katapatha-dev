import type { components } from "@katapatha/contracts/types";

/**
 * The rules for a load check and a chiller reading, in one place so the modal
 * can disable "Send" and the server action can refuse with the same words.
 */

export type Condition = NonNullable<components["schemas"]["LoadCheck"]["condition"]>;

export const CONDITIONS: Condition[] = ["OK", "SHORT", "DAMAGED", "MISSING"];

export type LoadCheckInput = {
  tripId: string;
  orderId: string;
  expectedUnits: number;
  loadedUnits: number;
  condition: Condition;
  checkedByName: string;
  reasonCode: string | null;
  clientRequestId: string;
};

const MAX_UNITS = 999_999;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The reason a check cannot be saved, or null. Order matters: the first thing
 *  the loader can fix is the first thing said. */
export function validateLoadCheck(input: LoadCheckInput): string | null {
  if (!input.tripId || !input.orderId) return "This line is no longer valid. Reload the trip and try again.";
  if (!CONDITIONS.includes(input.condition)) return "Pick Loaded, Short, Damaged or Missing.";
  if (typeof input.checkedByName !== "string" || input.checkedByName.trim().length < 2) {
    return "Enter who is checking. The dock terminal is shared, so every check carries a real name.";
  }
  if (!Number.isInteger(input.loadedUnits) || input.loadedUnits < 0) return "Loaded units must be a whole number, zero or more.";
  if (input.loadedUnits > MAX_UNITS) return "That is more units than a trip can carry. Check the number.";
  if (input.condition === "OK" && input.loadedUnits !== input.expectedUnits) {
    return "A line is only loaded correctly when the loaded units match what was ordered. Report it as short instead.";
  }
  if (input.condition === "SHORT" && input.loadedUnits >= input.expectedUnits) {
    return "Short means fewer units loaded than ordered. Lower the loaded units, or mark the line loaded.";
  }
  if (input.condition === "MISSING" && input.loadedUnits !== 0) return "A missing line has no units loaded. Set loaded units to 0.";
  if (input.condition !== "OK" && !input.reasonCode) return "Pick a reason. A reported line holds the vehicle until the dispatcher decides.";
  if (typeof input.clientRequestId !== "string" || !UUID.test(input.clientRequestId)) return "Reload the page and try again.";
  return null;
}

/** Units not loaded on a line, never negative. */
export function shortBy(expected: number, loaded: number): number {
  return Math.max(expected - loaded, 0);
}

/** The reason code to preselect for a condition, when the server's vocabulary
 *  offers a natural match; otherwise nothing, so the loader chooses. */
export function defaultReason(condition: Condition, reasons: string[]): string {
  const preferred = condition === "DAMAGED" ? "DAMAGED" : condition === "MISSING" ? "MISSING" : "SHORT_QUANTITY";
  return reasons.includes(preferred) ? preferred : (reasons[0] ?? "");
}

export function validateChillerTemp(value: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Enter the temperature the gauge shows.";
  if (value < -30 || value > 40) return "Gauge readings must be between -30 and 40 °C. Check the number.";
  return null;
}

/** "6 °C", "3.8 °C" — no trailing zero, and a real minus sign for a freezer. */
export function formatTemp(tempC: number): string {
  const rounded = Math.round(tempC * 10) / 10;
  return `${String(rounded).replace("-", "−")} °C`;
}

/** A v4 UUID. `randomUUID` needs a secure context; a dock tablet on a plain
 *  http depot address is not one, so there is a fallback. Collisions matter,
 *  cryptographic strength does not: the server only dedupes on the string. */
export function newUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}
