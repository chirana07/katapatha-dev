import type { components } from "@katapatha/contracts/types";

type Create = components["schemas"]["CreateVehicleRequest"];
type Update = components["schemas"]["UpdateVehicleRequest"];
export type VehicleType = Create["type"];
/** What a vehicle can carry. Not an order's TempRequirement: a reefer carries any order. */
export type VehicleTemp = Create["temp"];

export const VEHICLE_TYPES: readonly VehicleType[] = ["truck", "van"];
export const VEHICLE_TEMPS: readonly VehicleTemp[] = ["reefer", "ambient"];
export const VEHICLE_ID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

/** The API's limits, kept beside the checks that use them. */
export const LIMITS = {
  weightCapKg: 40_000,
  volumeCapM3: 120,
  kmPerL: 50,
  weeklyFuelQuotaL: 10_000,
  fuelType: 24,
} as const;

/** What the form holds: every field as the text the admin typed or picked. */
export interface VehicleFormValues {
  id: string;
  type: string;
  temp: string;
  weightCapKg: string;
  volumeCapM3: string;
  fuelType: string;
  kmPerL: string;
  weeklyFuelQuotaL: string;
  depotCode: string;
}

export type VehicleField = keyof VehicleFormValues;
export type FieldErrors = Partial<Record<VehicleField, string>>;

export const EMPTY_VEHICLE_FORM: VehicleFormValues = {
  id: "",
  type: "truck",
  temp: "ambient",
  weightCapKg: "",
  volumeCapM3: "",
  // Almost the whole fleet runs on it; the admin changes it for the exception.
  fuelType: "diesel",
  kmPerL: "",
  weeklyFuelQuotaL: "",
  depotCode: "",
};

export function readVehicleForm(formData: FormData): VehicleFormValues {
  const text = (name: VehicleField) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    id: text("id"),
    type: text("type"),
    temp: text("temp"),
    weightCapKg: text("weightCapKg"),
    volumeCapM3: text("volumeCapM3"),
    fuelType: text("fuelType"),
    kmPerL: text("kmPerL"),
    weeklyFuelQuotaL: text("weeklyFuelQuotaL"),
    depotCode: text("depotCode"),
  };
}

/** The id as the fleet stores it: upper-case, no stray spaces. */
export function normaliseVehicleId(value: string): string {
  return value.trim().toUpperCase();
}

type Parsed = { value: number } | { error: string };

/** A figure that must be above 0, decimals allowed: volume, km/L. */
function positive(value: string, label: string, maximum: number): Parsed {
  const text = value.trim();
  if (text === "") return { error: `Enter the ${label}.` };
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return { error: `The ${label} must be a number above 0.` };
  if (parsed > maximum) return { error: `The ${label} can be at most ${maximum.toLocaleString("en-GB")}.` };
  return { value: parsed };
}

/** A whole number in a range: weight capacity, weekly quota. */
function whole(value: string, label: string, minimum: number, maximum: number): Parsed {
  const text = value.trim();
  if (text === "") return { error: `Enter the ${label}.` };
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return { error: `The ${label} is a whole number from ${minimum.toLocaleString("en-GB")} to ${maximum.toLocaleString("en-GB")}.` };
  }
  return { value: parsed };
}

type Shared = Omit<Create, "id" | "depotCode">;
type Checked = { ok: true; fields: Shared } | { ok: false; errors: FieldErrors };

/** The fields a create and an edit share. */
function checkFields(values: VehicleFormValues): Checked {
  const errors: FieldErrors = {};

  if (!VEHICLE_TYPES.includes(values.type as VehicleType)) errors.type = "Choose truck or van.";
  if (!VEHICLE_TEMPS.includes(values.temp as VehicleTemp)) errors.temp = "Choose refrigerated or ambient.";

  const weight = whole(values.weightCapKg, "weight capacity", 1, LIMITS.weightCapKg);
  if ("error" in weight) errors.weightCapKg = weight.error;
  const volume = positive(values.volumeCapM3, "volume capacity", LIMITS.volumeCapM3);
  if ("error" in volume) errors.volumeCapM3 = volume.error;
  const economy = positive(values.kmPerL, "fuel economy", LIMITS.kmPerL);
  if ("error" in economy) errors.kmPerL = economy.error;
  const quota = whole(values.weeklyFuelQuotaL, "weekly fuel quota", 0, LIMITS.weeklyFuelQuotaL);
  if ("error" in quota) errors.weeklyFuelQuotaL = quota.error;

  const fuelType = values.fuelType.trim().toLowerCase();
  if (fuelType.length < 1 || fuelType.length > LIMITS.fuelType) errors.fuelType = "Name the fuel in 1 to 24 characters, for example diesel.";

  if (Object.keys(errors).length > 0 || "error" in weight || "error" in volume || "error" in economy || "error" in quota) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    fields: {
      type: values.type as VehicleType,
      temp: values.temp as VehicleTemp,
      weightCapKg: weight.value,
      volumeCapM3: volume.value,
      fuelType,
      kmPerL: economy.value,
      weeklyFuelQuotaL: quota.value,
    },
  };
}

/**
 * A new vehicle. `depotCodes` are the depots the admin could pick from, so a
 * hand-edited POST naming a depot that does not exist is refused here rather
 * than as a bare 422.
 */
export function validateNewVehicle(
  values: VehicleFormValues,
  depotCodes?: readonly string[],
): { ok: true; data: Create } | { ok: false; errors: FieldErrors } {
  const id = normaliseVehicleId(values.id);
  const depotCode = values.depotCode.trim();
  const checked = checkFields(values);
  const errors: FieldErrors = checked.ok ? {} : checked.errors;
  if (!VEHICLE_ID_PATTERN.test(id)) {
    errors.id = "Use 2 to 32 letters, digits, dashes or underscores, starting with a letter or digit. For example VEH120.";
  }
  if (depotCode === "" || (depotCodes && !depotCodes.includes(depotCode))) errors.depotCode = "Choose the depot the vehicle runs from.";
  if (!checked.ok || errors.id || errors.depotCode) return { ok: false, errors };
  return { ok: true, data: { id, depotCode, ...checked.fields } };
}

/** The id and depot are fixed once created, so an edit never sends them. */
export function validateVehicleEdit(values: VehicleFormValues): { ok: true; data: Update } | { ok: false; errors: FieldErrors } {
  const checked = checkFields(values);
  return checked.ok ? { ok: true, data: checked.fields } : { ok: false, errors: checked.errors };
}
