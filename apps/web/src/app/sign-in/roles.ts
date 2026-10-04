import type { RoleGlyphKind } from "@/components/ui/role-glyph";

/**
 * Per-role copy for the four sign-in screens (D-01, L-01, R-01, S-01).
 *
 * The role in the query string is presentation only. It changes the heading and
 * the words around the form; it never decides where the person lands. That is
 * still the API's role for the account, run through `safePostLoginPath`, so
 * opening `?role=dispatcher` and signing in as a loader lands in /loader, not
 * in a workspace the account may not use.
 */
export type SignInRole = "dispatcher" | "loader" | "driver" | "store";

export interface RoleCopy {
  role: SignInRole;
  glyph: RoleGlyphKind;
  /** "KATAPATHA / DISPATCHER" on the dark panel. */
  eyebrow: string;
  /** Where the person works, and on what. The line above the form's heading. */
  context: string;
  heading: string;
  headline: string;
  lead: string;
  points: [string, string, string];
  /** The button words, "Open dispatcher workspace". */
  submit: string;
  /** How this role signs in. The loader's shared dock tablet takes a staff ID
   *  and PIN (L-01); everyone else, a work email and password. */
  credential: "email" | "staff";
}

export const ROLE_COPY: Record<SignInRole, RoleCopy> = {
  dispatcher: {
    role: "dispatcher",
    glyph: "dispatcher",
    eyebrow: "Katapatha / Dispatcher",
    context: "Planning office · Desktop",
    heading: "Sign in to dispatcher",
    headline: "The right view for the work in front of you.",
    lead: "Turn confirmed orders into a plan the whole team can trust.",
    points: ["Allocate orders", "Record deferrals", "Monitor delivery progress"],
    submit: "Open dispatcher workspace",
    credential: "email",
  },
  loader: {
    role: "loader",
    glyph: "loader",
    eyebrow: "Katapatha / Loader",
    context: "Dock · Shared tablet",
    heading: "Sign in to loader",
    headline: "Load in the right order, every time.",
    lead: "Load each stop in the right order and flag shortages before departure.",
    points: ["See the loading sequence", "Record loaded counts", "Flag shortages early"],
    submit: "Open loader workspace",
    credential: "staff",
  },
  driver: {
    role: "driver",
    glyph: "driver",
    eyebrow: "Katapatha / Driver",
    context: "On the road · Phone",
    heading: "Sign in to driver",
    headline: "The next stop, always in view.",
    lead: "See your route and record every delivery, stop by stop.",
    points: ["See the next stop", "Record counts and receipts", "Report a problem at the door"],
    submit: "Open driver workspace",
    credential: "email",
  },
  store: {
    role: "store",
    glyph: "store",
    eyebrow: "Katapatha / Store manager",
    context: "Outlet · Counter PC or phone",
    heading: "Sign in to store",
    headline: "Know what's coming before it arrives.",
    lead: "Know when stock is coming, place tomorrow's order, and confirm receipt.",
    points: ["Track incoming deliveries", "Place and edit orders", "Confirm receipt and report issues"],
    submit: "Open store workspace",
    credential: "email",
  },
};

export const ROLE_ORDER: SignInRole[] = ["dispatcher", "loader", "driver", "store"];

/** Anything that is not exactly one of the four names is "no role chosen". */
export function parseSignInRole(value: string | string[] | undefined): SignInRole | null {
  if (typeof value !== "string") return null;
  return (ROLE_ORDER as string[]).includes(value) ? (value as SignInRole) : null;
}
