/**
 * The words on the failed-delivery / skipped-stop screen (R-11), apart from the
 * reasons themselves (reason-presentation.ts) and anything about what is held on
 * the phone or sent later (src/outbox/claims.ts `problemSendNote`).
 *
 * "What happens next" may say ONLY what the server does with a FAILED or SKIPPED
 * event. Every clause below was checked against the code, and the lines relied on
 * are listed beside it:
 *
 *  - "The stop is closed as failed / skipped": reportProblem sets the TripStop
 *    status to the event's outcome (apps/api/src/services/delivery.ts:351-354),
 *    and the applier passes `outcome: SKIPPED | FAILED` from the event type
 *    (apps/api/src/services/stopEvents.ts:723). Afterwards a later UNLOAD_START is
 *    refused (delivery.ts:140-145).
 *  - "Dispatch sees the reason as an open problem under Exceptions": reportProblem
 *    creates a Problem row (delivery.ts:317-328) whose kind is the reason code
 *    (stopEvents.ts:714, toProblemKind at 180-192), raised by the driver; the
 *    exception list loads problems of the depot's users that are not resolved
 *    (apps/api/src/services/exceptions.ts:1321-1345) and derives an open
 *    "on the road" PROBLEM exception for each (exceptions.ts:986-1032).
 *  - "Nothing is recorded as delivered for this stop": the path writes no
 *    delivered line and changes no order (delivery.ts:287-368); only completeStop
 *    marks a delivery (delivery.ts:236-262).
 *
 * What it must NOT say, because nothing in the code does it: that the outlet is
 * told (the only notification created on a stop is the "Your delivery has
 * arrived" one in completeStop, delivery.ts:255; reportProblem creates none),
 * that the units stay on the vehicle or return to the depot (no such model),
 * that the order is redelivered or first on tomorrow's run (nothing materialises
 * a next-day order), or that dispatch is "told now" (there is no push to
 * dispatch; the problem is on their list once the server has the record).
 */

export type ProblemOutcome = "FAILED" | "SKIPPED";

export const PROBLEM_QUESTION: Record<ProblemOutcome, string> = {
  FAILED: "What stopped the delivery?",
  SKIPPED: "Why are you skipping this stop?",
};

export const PROBLEM_PRIMARY_LABEL: Record<ProblemOutcome, string> = {
  FAILED: "Record failed delivery",
  SKIPPED: "Record skipped stop",
};

/** The header badge: solid red for a failed delivery, quiet for a skip. */
export const PROBLEM_BADGE: Record<ProblemOutcome, { label: string; tone: "bad" | "neutral" }> = {
  FAILED: { label: "Can't deliver", tone: "bad" },
  SKIPPED: { label: "Skipping", tone: "neutral" },
};

/** The line above the bar while the button is disabled: the unmet condition. */
export function reasonRequiredNote(outcome: ProblemOutcome): string {
  return outcome === "FAILED"
    ? "Choose what stopped the delivery to record it."
    : "Choose why you are skipping this stop to record it.";
}

/** The secondary option that switches between the two outcomes, and why it exists. */
export function otherOutcome(outcome: ProblemOutcome): {
  label: string;
  explanation: string;
} {
  return outcome === "FAILED"
    ? {
        label: "Skip this stop instead",
        explanation:
          "Skip is for a stop you are passing over without trying. If you reached the outlet and could not deliver, record a failed delivery.",
      }
    : {
        label: "Record a failed delivery instead",
        explanation:
          "Failed is for a stop you went to and could not deliver. Skip is for one you are passing over without trying.",
      };
}

/** What the server does with the record, as the lines of the "What happens next" box. */
export function consequenceLines(outcome: ProblemOutcome): string[] {
  return [
    outcome === "FAILED"
      ? "The stop is closed as failed."
      : "The stop is closed as skipped.",
    "Dispatch sees your reason as an open problem under Exceptions.",
    "Nothing is recorded as delivered for this stop.",
  ];
}

/** Shown instead of the form when this stop can no longer take a problem report. */
export function alreadyClosedNote(status: string): string {
  switch (status) {
    case "DONE":
      return "This stop is already delivered, so a problem cannot be reported on it.";
    case "FAILED":
      return "This stop is already recorded as failed. Nothing more to record.";
    case "SKIPPED":
      return "This stop is already recorded as skipped. Nothing more to record.";
    default:
      return "This stop is already closed. Nothing more to record.";
  }
}
