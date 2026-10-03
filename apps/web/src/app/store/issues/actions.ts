"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { writeFailure, type Failure } from "@/lib/failures";
import { validateIssue } from "../validation";

export type RaiseIssueState = { error?: Failure };

type ApiError = { error?: { code?: string; message?: string } };

/**
 * Raise an issue with dispatch.
 *
 * `clientRequestId` is minted with the page, so a double click or a retry after
 * a lost response returns the first issue (200) instead of raising a second.
 * On success the manager lands on the list with the issue's id in `sent`; the
 * page only believes it if that id is really in the outlet's list.
 */
export async function raiseIssue(_previous: RaiseIssueState, formData: FormData): Promise<RaiseIssueState> {
  await requireRole("STORE_MANAGER", "/store/issues");

  const request = validateIssue({
    orderId: formData.get("orderId"),
    choice: formData.get("choice"),
    units: formData.get("units"),
    note: formData.get("note"),
    clientRequestId: formData.get("clientRequestId"),
  });
  if (!request.ok) return { error: { title: "Check the report", detail: request.error, outcome: "failed" } };

  let status = 0;
  let issueId: string | null = null;
  let refusal: ApiError["error"];
  try {
    const client = await api();
    const result = await client.POST("/issues", { body: request.data });
    status = result.response.status;
    if (!result.error && result.data) issueId = result.data.id;
    else refusal = (result.error as ApiError | undefined)?.error;
  } catch {
    // No answer: the issue may exist. writeFailure says so.
  }

  if (!issueId) {
    if (refusal?.code === "UNITS_EXCEED_ORDER" && refusal.message) {
      return { error: { title: "More units than were ordered", detail: refusal.message, outcome: "failed" } };
    }
    if (refusal?.code === "IDEMPOTENCY_KEY_REUSED") {
      return { error: { title: "Reload to report another issue", detail: "This form was already used for a different report.", outcome: "failed" } };
    }
    return { error: writeFailure(status, "send the report") };
  }

  revalidatePath("/store", "layout");
  redirect(`/store/issues?sent=${encodeURIComponent(issueId)}`);
}
