import type { components } from "@katapatha/contracts/types";

type Create = components["schemas"]["CreateOutletRequest"];
type Update = components["schemas"]["UpdateOutletRequest"];
type Brand = components["schemas"]["Brand"];
export type DockType = Create["dockType"];
export type ParkingConstraint = Create["parkingConstraint"];

export const BRANDS: readonly Brand[] = ["Fresh", "Style", "Tech"];
export const DOCK_TYPES: readonly DockType[] = ["rear_dock", "street", "mall_bay"];
export const PARKING_CONSTRAINTS: readonly ParkingConstraint[] = ["normal", "van_only", "mall_dock"];
export const OUTLET_ID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

/** The same bounds the API holds a position to: Sri Lanka, with a margin. */
export const LAT_RANGE = { min: 5.8, max: 9.9 } as const;
export const LNG_RANGE = { min: 79.5, max: 82.0 } as const;

/** What the form holds: every field as the text the admin typed or picked. */
export interface OutletFormValues {
  id: string;
  /** "" means no name of its own: the outlet is shown by its id. */
  displayName: string;
  brand: string;
  districtName: string;
  dockType: string;
  parkingConstraint: string;
  /** "HH:MM", 24-hour, as a time input gives it. Never a Date. */
  windowOpen: string;
  windowClose: string;
  /** Both "" when the outlet has no separate mall receiving window. */
  mallWindowOpen: string;
  mallWindowClose: string;
  /** Both "" to let the API place it near the district centre. */
  lat: string;
  lng: string;
}

export type OutletField = keyof OutletFormValues;
export type FieldErrors = Partial<Record<OutletField, string>>;

export const EMPTY_OUTLET_FORM: OutletFormValues = {
  id: "",
  displayName: "",
  brand: "",
  districtName: "",
  dockType: "rear_dock",
  parkingConstraint: "normal",
  windowOpen: "",
  windowClose: "",
  mallWindowOpen: "",
  mallWindowClose: "",
  lat: "",
  lng: "",
};

const FIELDS = Object.keys(EMPTY_OUTLET_FORM) as OutletField[];

export function readOutletForm(formData: FormData): OutletFormValues {
  const values = { ...EMPTY_OUTLET_FORM };
  for (const field of FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === "string" ? value : "";
  }
  return values;
}

/** The id as outlets are keyed: upper-case, no stray spaces. */
export function normaliseOutletId(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * A clock time as the API takes it, or null when it is not one. A single-digit
 * hour ("5:30") is padded, since that is how people type it; anything else
 * that is not a real 24-hour "HH:MM" is refused rather than guessed at.
 */
export function parseClock(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

/** "HH:MM" strings compare correctly as text, so no Date is ever built. */
function before(open: string, close: string): boolean {
  return open < close;
}

type Windows = Pick<Update, "windowOpen" | "windowClose" | "mallWindowOpen" | "mallWindowClose">;
type Shared = Required<Pick<Update, "displayName" | "dockType" | "parkingConstraint">> & Required<Windows>;
type Checked = { ok: true; fields: Shared } | { ok: false; errors: FieldErrors };

/**
 * The fields a create and an edit share: the name, how the outlet receives,
 * and when. Every error is collected so the form can mark them all at once.
 */
function checkFields(values: OutletFormValues): Checked {
  const errors: FieldErrors = {};

  const displayName = values.displayName.trim();
  if (displayName.length > 120) errors.displayName = "Keep the name to 120 characters or fewer.";

  if (!DOCK_TYPES.includes(values.dockType as DockType)) errors.dockType = "Choose rear dock, street or mall bay.";
  if (!PARKING_CONSTRAINTS.includes(values.parkingConstraint as ParkingConstraint)) {
    errors.parkingConstraint = "Choose normal, vans only or mall dock.";
  }

  const windowOpen = parseClock(values.windowOpen);
  const windowClose = parseClock(values.windowClose);
  if (!windowOpen) errors.windowOpen = "Enter the time receiving opens, for example 05:00.";
  if (!windowClose) errors.windowClose = "Enter the time receiving closes, for example 08:30.";
  if (windowOpen && windowClose && !before(windowOpen, windowClose)) {
    errors.windowClose = "Receiving must close after it opens.";
  }

  // The mall window is all or nothing: half a window cannot be planned against.
  const mallOpenText = values.mallWindowOpen.trim();
  const mallCloseText = values.mallWindowClose.trim();
  let mallWindowOpen: string | null = null;
  let mallWindowClose: string | null = null;
  if (mallOpenText !== "" || mallCloseText !== "") {
    mallWindowOpen = parseClock(mallOpenText);
    mallWindowClose = parseClock(mallCloseText);
    if (!mallWindowOpen) errors.mallWindowOpen = mallOpenText === "" ? "Give both mall times, or neither." : "Enter a time such as 06:00.";
    if (!mallWindowClose) errors.mallWindowClose = mallCloseText === "" ? "Give both mall times, or neither." : "Enter a time such as 10:00.";
    if (mallWindowOpen && mallWindowClose && !before(mallWindowOpen, mallWindowClose)) {
      errors.mallWindowClose = "The mall window must close after it opens.";
    }
  } else if (values.dockType === "mall_bay") {
    // A mall bay is only reachable while the mall lets deliveries in.
    errors.mallWindowOpen = "A mall bay needs the mall's delivery window.";
  }

  if (Object.keys(errors).length > 0 || !windowOpen || !windowClose) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      displayName: displayName === "" ? null : displayName,
      dockType: values.dockType as DockType,
      parkingConstraint: values.parkingConstraint as ParkingConstraint,
      windowOpen,
      windowClose,
      mallWindowOpen,
      mallWindowClose,
    },
  };
}

function coordinate(value: string, range: { min: number; max: number }): number | null {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < range.min || parsed > range.max) return null;
  return parsed;
}

export function validateNewOutlet(values: OutletFormValues): { ok: true; data: Create } | { ok: false; errors: FieldErrors } {
  const id = normaliseOutletId(values.id);
  const checked = checkFields(values);
  const errors: FieldErrors = checked.ok ? {} : checked.errors;

  if (!OUTLET_ID_PATTERN.test(id)) {
    errors.id = "Use 2 to 32 letters, digits, dashes or underscores, starting with a letter or digit. For example OUT200.";
  }
  const brand = values.brand.trim();
  if (!BRANDS.includes(brand as Brand)) errors.brand = "Choose the brand the outlet trades as.";
  const districtName = values.districtName.trim();
  if (districtName === "") errors.districtName = "Choose the district the outlet is in.";

  // A position is both coordinates or neither; without one the API places the
  // outlet near its district centre and marks it approximate.
  const latText = values.lat.trim();
  const lngText = values.lng.trim();
  let position: { lat: number; lng: number } | null = null;
  if (latText !== "" || lngText !== "") {
    const lat = latText === "" ? null : coordinate(latText, LAT_RANGE);
    const lng = lngText === "" ? null : coordinate(lngText, LNG_RANGE);
    if (lat === null) errors.lat = latText === "" ? "Give both coordinates, or neither." : `Latitude is a number from ${LAT_RANGE.min} to ${LAT_RANGE.max}.`;
    if (lng === null) errors.lng = lngText === "" ? "Give both coordinates, or neither." : `Longitude is a number from ${LNG_RANGE.min} to ${LNG_RANGE.max}.`;
    if (lat !== null && lng !== null) position = { lat, lng };
  }

  if (!checked.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  const { displayName, mallWindowOpen, mallWindowClose, ...rest } = checked.fields;
  return {
    ok: true,
    data: {
      id,
      ...(displayName !== null ? { displayName } : {}),
      brand: brand as Brand,
      districtName,
      ...rest,
      ...(mallWindowOpen !== null && mallWindowClose !== null ? { mallWindowOpen, mallWindowClose } : {}),
      ...(position ?? {}),
    },
  };
}

/**
 * The id, brand and district are not editable (orders and plans hang on them)
 * and the position is moved on the dispatcher's map, so an edit carries only
 * the name, dock and windows. A cleared mall window is sent as null so it is
 * actually removed.
 */
export function validateOutletEdit(values: OutletFormValues): { ok: true; data: Update } | { ok: false; errors: FieldErrors } {
  const checked = checkFields(values);
  return checked.ok ? { ok: true, data: checked.fields } : { ok: false, errors: checked.errors };
}
