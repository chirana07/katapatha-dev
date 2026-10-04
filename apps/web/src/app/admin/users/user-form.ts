import type { components } from "@katapatha/contracts/types";

type Create = components["schemas"]["CreateUserRequest"];
type Update = components["schemas"]["UpdateUserRequest"];
export type Role = components["schemas"]["Role"];

/** In the order the tabs and the role select show them: the people on the ground first. */
export const ROLES: readonly Role[] = ["DISPATCHER", "LOADER", "DRIVER", "STORE_MANAGER", "ADMIN"];

export const ROLE_LABELS: Record<Role, string> = {
  DISPATCHER: "Dispatcher",
  LOADER: "Loader",
  DRIVER: "Driver",
  STORE_MANAGER: "Store manager",
  ADMIN: "Admin",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Dispatchers, loaders and drivers work out of one depot; it decides what they see. */
export function needsDepot(role: string): boolean {
  return role === "DISPATCHER" || role === "LOADER" || role === "DRIVER";
}

/** A store manager orders for one outlet. */
export function needsOutlet(role: string): boolean {
  return role === "STORE_MANAGER";
}

/** Deliberately loose: the API is the authority, this only catches typos before the round trip. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;
/** What the API accepts; the sign-in screens ask for the same pair. */
const PIN_PATTERN = /^[0-9]{4,8}$/;

/** What the form holds: every field as the text the admin typed or picked. */
export interface UserFormValues {
  email: string;
  name: string;
  role: string;
  /** Required on create; on edit "" keeps the current password. */
  password: string;
  /** The badge number the sign-in screens ask for. Stored upper-case. */
  staffId: string;
  /** 4 to 8 digits. Required on create; on edit "" keeps the current PIN. */
  pin: string;
  depotCode: string;
  outletId: string;
}

export type UserField = keyof UserFormValues;
export type FieldErrors = Partial<Record<UserField, string>>;

export const EMPTY_USER_FORM: UserFormValues = {
  email: "",
  name: "",
  role: "DRIVER",
  password: "",
  staffId: "",
  pin: "",
  depotCode: "",
  outletId: "",
};

export function readUserForm(formData: FormData): UserFormValues {
  const text = (name: UserField) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    email: text("email"),
    name: text("name"),
    role: text("role"),
    password: text("password"),
    staffId: text("staffId"),
    pin: text("pin"),
    depotCode: text("depotCode"),
    outletId: text("outletId"),
  };
}

/** Sign-in looks the address up trimmed and lower-cased, so the account must be stored that way to be found. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

type Binding = { role: Role; depotCode: string | null; outletId: string | null };
type Checked = { ok: true; fields: { name: string } & Binding } | { ok: false; errors: FieldErrors };

/**
 * The fields a create and an edit share. Only the binding that applies to the
 * role is sent and the other is nulled, so switching a driver to store manager
 * does not leave a stale depot on the account.
 */
function checkFields(values: UserFormValues): Checked {
  const errors: FieldErrors = {};

  const name = values.name.trim();
  if (name.length < 2 || name.length > 120) errors.name = "Give their name in 2 to 120 characters.";

  const role = values.role.trim();
  if (!isRole(role)) errors.role = "Choose what they do.";

  const depotCode = values.depotCode.trim();
  const outletId = values.outletId.trim();
  if (needsDepot(role) && depotCode === "") errors.depotCode = "Choose the depot they work out of.";
  if (needsOutlet(role) && outletId === "") errors.outletId = "Choose the outlet they order for.";

  if (Object.keys(errors).length > 0 || !isRole(role)) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      name,
      role,
      depotCode: needsDepot(role) ? depotCode : null,
      outletId: needsOutlet(role) ? outletId : null,
    },
  };
}

/** Badges are printed in capitals and people type them any way; the API upper-cases too. */
export function normaliseStaffId(value: string): string {
  return value.trim().toUpperCase();
}

function staffIdError(staffId: string): string | undefined {
  if (staffId.length < 2 || staffId.length > 32) return "Enter the staff ID on their badge, for example DRV-0310.";
  return undefined;
}

function pinError(pin: string): string | undefined {
  return PIN_PATTERN.test(pin) ? undefined : "A PIN is 4 to 8 digits.";
}

function passwordError(password: string): string | undefined {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 200) return "Use at most 200 characters.";
  return undefined;
}

export function validateNewUser(values: UserFormValues): { ok: true; data: Create } | { ok: false; errors: FieldErrors } {
  const checked = checkFields(values);
  const errors: FieldErrors = checked.ok ? {} : checked.errors;

  const email = normaliseEmail(values.email);
  if (!EMAIL_PATTERN.test(email) || email.length > 160) errors.email = "Enter the email address they will sign in with.";

  // Not trimmed: a password is exactly what was typed.
  const password = passwordError(values.password);
  if (password) errors.password = password;

  // Both: the web sign-in asks for them, so an account without them could not use it.
  const staffId = normaliseStaffId(values.staffId);
  const staff = staffIdError(staffId);
  if (staff) errors.staffId = staff;
  const pin = pinError(values.pin.trim());
  if (pin) errors.pin = pin;

  if (!checked.ok || errors.email || errors.password || errors.staffId || errors.pin) return { ok: false, errors };
  return { ok: true, data: { email, password: values.password, staffId, pin: values.pin.trim(), ...checked.fields } };
}

/**
 * The email is not editable, so an edit never sends one. An empty password
 * leaves the current one alone; a new one is checked like a create's.
 */
export function validateUserEdit(values: UserFormValues): { ok: true; data: Update } | { ok: false; errors: FieldErrors } {
  const checked = checkFields(values);
  const errors: FieldErrors = checked.ok ? {} : checked.errors;

  const password = values.password === "" ? undefined : passwordError(values.password);
  if (password) errors.password = password;

  // Empty leaves them alone. Whether an account with no staff ID yet needs the
  // pair is for the API, which knows what the account already has.
  const staffId = normaliseStaffId(values.staffId);
  const staff = staffId === "" ? undefined : staffIdError(staffId);
  if (staff) errors.staffId = staff;
  const pin = values.pin.trim() === "" ? undefined : pinError(values.pin.trim());
  if (pin) errors.pin = pin;

  if (!checked.ok || errors.password || errors.staffId || errors.pin) return { ok: false, errors };
  return {
    ok: true,
    data: {
      ...checked.fields,
      ...(values.password !== "" ? { password: values.password } : {}),
      ...(staffId !== "" ? { staffId } : {}),
      ...(values.pin.trim() !== "" ? { pin: values.pin.trim() } : {}),
    },
  };
}
