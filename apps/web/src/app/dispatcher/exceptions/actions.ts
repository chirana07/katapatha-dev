"use server";

import { revalidatePath } from "next/cache";
import type { components } from "@katapatha/contracts/types";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readOf } from "@/lib/read-result";
import { decisionFailure } from "./decision-errors";

type Schemas = components["schemas"];

export type DecisionState =
  | { status: "idle" }
  | {
      status: "done";
      /** Same decision already applied: the server did nothing this time. */
      replayed: boolean;
      /** What was actually done, in order, as the API reports it. */
      consequences: { who: string; detail: string }[];
    }
  | { status: "failed"; title: string; detail: string; outcome: "failed" | "unknown" | "read" };

const CODES: readonly Schemas["ExceptionDecisionCode"][] = [
  "SEND_SHORT",
  "HOLD_ORDER",
  "CANCEL_LINE",
  "MOVE_TO_TRIP_2",
  "ACKNOWLEDGE",
  "RESOLVE",
];

/**
 * Applies one decision. The role is re-checked here because the layout cannot
 * guard an action: this is reachable by a direct POST.
 *
 * Nothing is retried. The API treats the same decision twice as a replay and a
 * different decision as a conflict, so a second press after an unclear failure
 * is safe, and the copy for "unknown" says to look before pressing again.
 */
export async function decideException(_previous: DecisionState, formData: FormData): Promise<DecisionState> {
  await requireRole("DISPATCHER", "/dispatcher/exceptions");

  const exceptionId = String(formData.get("exceptionId") ?? "");
  const decision = String(formData.get("decision") ?? "") as Schemas["ExceptionDecisionCode"];
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const followUp = formData.get("followUp") === "on";

  if (!exceptionId || exceptionId.length > 200 || !CODES.includes(decision)) {
    return {
      status: "failed",
      title: "Choose a decision first",
      detail: "No decision was selected, so nothing was sent.",
      outcome: "failed",
    };
  }

  const client = await api();
  const result = await readOf(
    client.POST("/exceptions/{exceptionId}/decision", {
      params: { path: { exceptionId } },
      body: { decision, ...(note ? { note } : {}), ...(followUp ? { followUp: true } : {}) },
    }),
  );

  if (!result.ok) {
    const failure = decisionFailure(result.status, result.code, result.message, result.details);
    if (failure.refresh) revalidatePath("/dispatcher/exceptions");
    return { status: "failed", title: failure.title, detail: failure.detail, outcome: failure.outcome };
  }

  // The list, the tab counts and the dashboard's exception badge all change.
  revalidatePath("/dispatcher/exceptions");
  revalidatePath("/dispatcher");
  return {
    status: "done",
    replayed: result.data.replayed,
    consequences: result.data.consequences.map((item) => ({ who: item.title, detail: item.detail })),
  };
}
