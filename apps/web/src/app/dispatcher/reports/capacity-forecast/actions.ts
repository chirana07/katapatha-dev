"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readOf } from "@/lib/read-result";
import { capacityFailure } from "./capacity-model";

export type CapacityState =
  | { status: "idle" }
  | { status: "done"; decision: "APPROVE" | "REJECT" | "APPLY"; consequences: string[] }
  | { status: "failed"; title: string; detail: string; outcome: "failed" | "unknown" | "read" };

const DECISIONS = ["APPROVE", "REJECT", "APPLY"] as const;
const HERE = "/dispatcher/reports/capacity-forecast";

/**
 * Approve, reject or apply one capacity action. Re-checks the role: the page's
 * layout cannot guard a direct POST. The API's own `consequences` come back
 * verbatim, because they say plainly what was and was NOT done (applying a
 * hire is a record, not a booking).
 */
export async function decideCapacityAction(_previous: CapacityState, formData: FormData): Promise<CapacityState> {
  await requireRole("DISPATCHER", HERE);

  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "") as (typeof DECISIONS)[number];
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  if (!id || id.length > 100 || !DECISIONS.includes(decision)) {
    return { status: "failed", title: "Choose a decision first", detail: "Nothing was sent.", outcome: "failed" };
  }

  const client = await api();
  const result = await readOf(
    client.POST("/capacity-actions/{id}/decision", {
      params: { path: { id } },
      body: { decision, ...(note ? { note } : {}) },
    }),
  );

  if (!result.ok) {
    const failure = capacityFailure(result.status, result.code, result.message);
    if (failure.refresh) revalidatePath(HERE);
    return { status: "failed", title: failure.title, detail: failure.detail, outcome: failure.outcome };
  }

  revalidatePath(HERE);
  return { status: "done", decision, consequences: result.data.consequences };
}
