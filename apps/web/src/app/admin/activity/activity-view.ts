export const ACTIVITY_PATH = "/admin/activity";

/** The record kinds worth filtering by, with the words an admin would use. */
export const ENTITY_FILTERS = [
  { value: "User", label: "Accounts" },
  { value: "Outlet", label: "Outlets" },
  { value: "Vehicle", label: "Vehicles" },
  { value: "Product", label: "Products" },
  { value: "Order", label: "Orders" },
  { value: "Plan", label: "Plans" },
  { value: "Problem", label: "Problems" },
] as const;

export type EntityFilter = (typeof ENTITY_FILTERS)[number]["value"];

export function parseEntity(value: string | string[] | undefined): EntityFilter | null {
  const text = Array.isArray(value) ? value[0] : value;
  return ENTITY_FILTERS.find((f) => f.value === text)?.value ?? null;
}

export function activityHref(entity: EntityFilter | null): string {
  return entity ? `${ACTIVITY_PATH}?entity=${entity}` : ACTIVITY_PATH;
}

/**
 * "user.disable" → "Disabled an account". The log's action codes are stable
 * identifiers, not prose; anything not listed is shown as the code itself
 * rather than guessed at.
 */
const ACTION_WORDS: Record<string, string> = {
  "user.create": "Added an account",
  "user.update": "Changed an account",
  "user.disable": "Disabled an account",
  "user.enable": "Re-enabled an account",
  "outlet.create": "Added an outlet",
  "outlet.update": "Changed an outlet",
  "vehicle.create": "Added a vehicle",
  "vehicle.update": "Changed a vehicle",
  "product.create": "Added a product",
  "product.update": "Changed a product",
};

export function actionWords(action: string): string {
  return ACTION_WORDS[action] ?? action;
}

/** "4 Oct, 06:42", Colombo wall clock: the log spans days, so a bare time is ambiguous. */
export function whenText(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
