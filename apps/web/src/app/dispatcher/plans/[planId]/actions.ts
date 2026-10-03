"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dispatcherSession } from "../../session";

const DESK = "/dispatcher/planning";

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function validRequestId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function planPath(planId: string) {
  return `/dispatcher/plans/${encodeURIComponent(planId)}`;
}

/** The day's screens all read what a plan decision changes. */
function revalidatePlan(home: string) {
  revalidatePath("/dispatcher");
  revalidatePath(DESK);
  revalidatePath("/dispatcher/orders");
  revalidatePath(home);
}

/** The server's own error code, when it sent one: `{ error: { code } }`. */
function errorCode(error: unknown): string | undefined {
  const code = (error as { error?: { code?: unknown } } | undefined)?.error?.code;
  return typeof code === "string" ? code : undefined;
}

export async function confirmDeferrals(formData: FormData) {
  const planId = field(formData, "planId");
  const home = planPath(planId);
  if (!planId || planId.length > 128) redirect(`${DESK}?error=invalid_request`);

  // Collect reasonCode:<assignmentId> entries from the form. The page emits
  // one hidden input per deferral so we know the full set we're confirming,
  // even if the dispatcher left some selects unchanged.
  // Errors reopen the drawer the dispatcher was in, so the choice isn't lost.
  const defer = field(formData, "defer");
  const back = (error: string) =>
    defer && defer.length <= 128
      ? `${home}?defer=${encodeURIComponent(defer)}&error=${error}`
      : `${home}?error=${error}`;

  const decisions: Array<{ assignmentId: string; reasonCode: string; note: string | null }> = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("reasonCode:")) continue;
    const assignmentId = name.slice("reasonCode:".length);
    if (!assignmentId) continue;
    const reasonCode = typeof value === "string" ? value.trim() : "";
    if (!reasonCode) continue;
    const note = field(formData, `note:${assignmentId}`).slice(0, 500);
    decisions.push({ assignmentId, reasonCode, note: note || null });
  }
  if (decisions.length === 0) {
    redirect(back("deferrals_empty"));
  }

  const context = await dispatcherSession(home);
  if (!("client" in context)) redirect(back(context.error));

  // Saving reasons is a PUT of the whole decision, so repeating it is safe;
  // that is why an unanswered request can say "check, then save again" rather
  // than "failed".
  let result;
  try {
    result = await context.client.PUT("/plans/{planId}/deferrals", {
      params: { path: { planId } },
      body: { decisions },
    });
  } catch {
    redirect(back("deferrals_outcome_unknown"));
  }
  if (result.error || !result.data) {
    if (result.response.status === 401) redirect(`/sign-in?next=${encodeURIComponent(home)}`);
    if (result.response.status === 403) redirect(`${DESK}?error=forbidden`);
    if (result.response.status === 422) redirect(back("deferrals_rejected"));
    redirect(back("deferrals_outcome_unknown"));
  }

  revalidatePlan(home);
  redirect(`${home}?notice=deferrals_saved`);
}

export async function publishPlan(formData: FormData) {
  const planId = field(formData, "planId");
  const requestId = field(formData, "requestId");
  const home = planPath(planId);
  if (!planId || planId.length > 128 || !validRequestId(requestId)) redirect(`${DESK}?error=invalid_request`);

  const context = await dispatcherSession(home);
  if (!("client" in context)) redirect(`${home}?error=${context.error}`);
  const { client } = context;

  // Re-read before committing: the dispatcher confirmed against a page that may
  // be minutes old, and publication cannot be taken back.
  let plan;
  let validation;
  try {
    [plan, validation] = await Promise.all([
      client.GET("/plans/{planId}", { params: { path: { planId } } }),
      client.GET("/plans/{planId}/validation", { params: { path: { planId }, query: { stage: "publish" } } }),
    ]);
  } catch {
    redirect(`${home}?error=unreachable`);
  }
  if (plan.response.status === 401 || validation.response.status === 401) redirect(`/sign-in?next=${encodeURIComponent(home)}`);
  if (plan.response.status === 403 || validation.response.status === 403) redirect(`${DESK}?error=forbidden`);
  if (plan.error || !plan.data || validation.error || !validation.data) redirect(`${home}?error=stale`);
  if (plan.data.status !== "DRAFT") redirect(`${home}?error=already_published`);
  if (validation.data.blocking) redirect(`${home}?error=validation_blocked`);

  // The idempotency key belongs to this click, so a retry after a lost
  // response replays the first publication instead of racing it.
  let result;
  try {
    result = await client.POST("/plans/{planId}/publication", {
      params: { path: { planId }, header: { "Idempotency-Key": requestId } },
    });
  } catch {
    redirect(`${home}?error=publish_outcome_unknown&retry=${requestId}`);
  }
  if (result.error || !result.data) {
    if (result.response.status === 401) redirect(`/sign-in?next=${encodeURIComponent(home)}`);
    if (result.response.status === 403) redirect(`${DESK}?error=forbidden`);
    if (result.response.status === 409) redirect(`${home}?error=already_published`);
    if (result.response.status === 422) {
      redirect(`${home}?error=${errorCode(result.error) === "DEFERRALS_UNCONFIRMED" ? "deferrals_unconfirmed" : "validation_blocked"}`);
    }
    redirect(`${home}?error=publish_outcome_unknown&retry=${requestId}`);
  }

  revalidatePlan(home);
  redirect(`${home}?notice=published`);
}
