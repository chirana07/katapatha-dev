import { FALLBACK_PROBLEM_REASONS, labelFor } from "./reasons";

/**
 * How the failed-delivery screen words the server's problem reasons (R-11).
 *
 * The vocabulary is the server's (`snapshot.problemReasons`); only the wording
 * is presented here. The design gives four rows -- "Store closed · shutter
 * down", "No one to receive", "Can't reach the outlet", "Store refused the
 * goods" -- and the server has five codes, so the mapping is not one to one:
 *
 *  - OUTLET_CLOSED and DELIVERY_REFUSED take the design's wording.
 *  - ACCESS_DENIED and ROAD_BLOCKED are both "can't reach the outlet" in the
 *    design. The server keeps them apart (a blocked road delays the whole run,
 *    an outlet that will not let the vehicle in is one stop), and two rows with
 *    the same label would make a driver's tap meaningless. So the design's
 *    wording is used only when exactly one of the two is in the list; when both
 *    are, each keeps its own honest label.
 *  - "No one to receive" has no code in the vocabulary, so it is not offered:
 *    OUTLET_CLOSED is the nearest, and inventing a code would put a reason on a
 *    delivery record that nothing on the server recognises.
 *  - Any code the design has no wording for (VEHICLE_BREAKDOWN, a code added to
 *    the vocabulary later) keeps `labelFor`.
 */

export type ReasonOption = { code: string; label: string };

const DESIGN_LABEL: Record<string, string> = {
  OUTLET_CLOSED: "Store closed · shutter down",
  DELIVERY_REFUSED: "Store refused the goods",
};

const REACH_CODES = ["ACCESS_DENIED", "ROAD_BLOCKED"] as const;
const REACH_LABEL = "Can't reach the outlet";

/**
 * The rows to offer, in the server's order, each code once.
 *
 * An empty list means the device has never seen the server's vocabulary: the
 * local fallback list is used, and the caller says so (`reasonsAreFallback`).
 */
export function reasonOptions(codes: readonly string[]): ReasonOption[] {
  const source = codes.length > 0 ? codes : FALLBACK_PROBLEM_REASONS;
  const unique = [...new Set(source)];
  const reachCount = REACH_CODES.filter((code) => unique.includes(code)).length;

  return unique.map((code) => {
    if (code in DESIGN_LABEL) return { code, label: DESIGN_LABEL[code]! };
    if ((REACH_CODES as readonly string[]).includes(code) && reachCount === 1) {
      return { code, label: REACH_LABEL };
    }
    return { code, label: labelFor(code) };
  });
}

/**
 * The label for a reason code on a record that already exists (the closed-stop
 * summary). Uses the same wording as the picker; the full vocabulary is assumed
 * so a code that was one of two reach reasons is not shown as "Can't reach" when
 * the other one is merely absent from a trimmed list.
 */
export function reasonLabel(code: string | null | undefined): string {
  if (!code) return "No reason recorded";
  return DESIGN_LABEL[code] ?? labelFor(code);
}
