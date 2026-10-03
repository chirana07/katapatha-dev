import { writeFailure, type Failure } from "../../../lib/failures";
import { decidedAs } from "./model";

/**
 * What to tell the dispatcher when a decision did not go through.
 *
 * Each API refusal says something different, and the dispatcher's next move
 * depends on which: "someone else decided differently" means look at the panel,
 * "the condition cleared" means there is nothing left to do, "a note is
 * needed" means fix the form. Anything we do not recognise falls back to the
 * shared write wording, which keeps the rule that a request with no answer is
 * "unknown", never "failed".
 *
 * `refresh` says the panel behind the dialog is probably out of date, so the
 * action should revalidate the page.
 */
export interface DecisionFailure extends Failure {
  refresh: boolean;
}

export function decisionFailure(
  status: number,
  code: string | null,
  message: string | null,
  details: unknown,
): DecisionFailure {
  if (status === 404 && code === "EXCEPTION_NOT_ACTIVE") {
    return {
      title: "That condition has cleared",
      detail: "The evidence behind this item changed, so there is nothing left to decide. Nothing was changed.",
      outcome: "failed",
      refresh: true,
    };
  }
  if (status === 404) {
    return {
      title: "That exception is gone",
      detail: "It may have been resolved or removed. Nothing was changed.",
      outcome: "failed",
      refresh: true,
    };
  }
  if (status === 422 && code === "NOTE_REQUIRED") {
    return {
      title: "A note is needed",
      detail: "Resolving a problem keeps your note as the resolution, and the store is sent it. Add a note and confirm again.",
      outcome: "failed",
      refresh: false,
    };
  }
  if (status === 409 && code === "ALREADY_DECIDED") {
    const info = (details ?? {}) as { resolution?: string; decidedBy?: string };
    const who = info.decidedBy ? `${info.decidedBy} already` : "This was already";
    return {
      title: "This was already decided",
      detail: `${who} decided to ${decidedAs(info.resolution)}. Your decision was not applied; the panel now shows the current state.`,
      outcome: "failed",
      refresh: true,
    };
  }
  if (status === 409 && code === "DECISION_NOT_AVAILABLE") {
    return {
      title: "That option is no longer offered",
      detail: message ?? "What can be decided changed while this dialog was open. Nothing was changed; choose again from the panel.",
      outcome: "failed",
      refresh: true,
    };
  }
  if (status === 409 && code === "NO_DECISION_AVAILABLE") {
    return {
      title: "Nothing to decide here",
      detail: "Planning items are resolved in the planning desk, not in this console. Nothing was changed.",
      outcome: "failed",
      refresh: false,
    };
  }
  if (status === 409 && code === "RACE_LOST") {
    return {
      title: "Someone decided at the same moment",
      detail: "Another dispatcher's decision landed first. Nothing of yours was applied; the panel now shows the result.",
      outcome: "failed",
      refresh: true,
    };
  }
  if (status === 422) {
    return {
      title: "The server refused this",
      detail: message ?? "Review the note and confirm again.",
      outcome: "failed",
      refresh: false,
    };
  }
  return { ...writeFailure(status, "confirm the decision"), refresh: status === 409 };
}
