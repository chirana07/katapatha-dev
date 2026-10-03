"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDateOnly } from "@/lib/dates";
import { dispatcherSession } from "./session";

const DASHBOARD = "/dispatcher";
const DESK = "/dispatcher/planning";

/**
 * Where an action returns to. The planning desk is where these controls live,
 * but the dashboard's "next step" card runs the same actions and must land the
 * dispatcher back on the dashboard, not on a screen they did not leave.
 */
function home(from: string) {
  return from === "dashboard" ? DASHBOARD : DESK;
}

/**
 * Back to where the action came from, keeping the `?date=` the dispatcher was
 * looking at. Without it a rehearsal on a past date bounced to today after every
 * action and showed "No planning day found".
 */
function back(from: string, date: string, query: string) {
  return isDateOnly(date) ? `${home(from)}?date=${date}&${query}` : `${home(from)}?${query}`;
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Orders, the dashboard and the desk all read what these actions change. */
function revalidateDesk() {
  revalidatePath(DASHBOARD);
  revalidatePath(DESK);
  revalidatePath("/dispatcher/orders");
}

export async function closeQueue(formData: FormData) {
  const planningDayId = text(formData, "planningDayId");
  const date = text(formData, "date");
  const from = text(formData, "from");
  if (!planningDayId) redirect(back(from, date, "error=invalid_request"));

  const context = await dispatcherSession(home(from));
  if (!("client" in context)) redirect(back(from, date, `error=${context.error}`));

  let result;
  try {
    result = await context.client.POST("/planning-days/{planningDayId}/closure", {
      params: { path: { planningDayId } },
    });
  } catch {
    redirect(back(from, date, "error=close_outcome_unknown"));
  }

  if (result.error || !result.data) {
    const code = result.response.status === 403 ? "forbidden" : result.response.status === 404 ? "stale" : "close_outcome_unknown";
    redirect(back(from, date, `error=${code}`));
  }

  revalidateDesk();
  redirect(back(from, date, "notice=queue_closed"));
}

export async function createPlan(formData: FormData) {
  const date = text(formData, "date");
  const depotCode = text(formData, "depotCode");
  const requestId = text(formData, "requestId");
  const from = text(formData, "from");
  if (!isDateOnly(date) || !depotCode || !validUuid(requestId)) {
    redirect(back(from, date, "error=invalid_request"));
  }

  const context = await dispatcherSession(home(from));
  if (!("client" in context)) redirect(back(from, date, `error=${context.error}`));
  if (context.user.depotCode !== depotCode) redirect(back(from, date, "error=forbidden"));

  // The same request id goes with every retry of this click, so a double
  // submit or a retry after a timeout builds one draft, not two.
  let result;
  try {
    result = await context.client.POST("/plans", {
      params: {
        header: { "Idempotency-Key": requestId },
      },
      body: { date, depotCode },
    });
  } catch {
    redirect(back(from, date, `error=plan_outcome_unknown&retry=${requestId}`));
  }

  if (result.error || !result.data) {
    if (result.response.status === 409) redirect(back(from, date, "error=queue_open"));
    if (result.response.status === 422) redirect(back(from, date, "error=plan_invalid"));
    redirect(back(from, date, `error=plan_outcome_unknown&retry=${requestId}`));
  }

  revalidateDesk();
  redirect(back(from, date, "notice=plan_created"));
}

export async function setVehicleStatus(formData: FormData) {
  const date = text(formData, "date");
  const vehicleId = text(formData, "vehicleId");
  const status = text(formData, "status");
  const note = text(formData, "note").slice(0, 200);
  const from = text(formData, "from");
  if (!isDateOnly(date) || !vehicleId || vehicleId.length > 32 || (status !== "AVAILABLE" && status !== "IN_WORKSHOP")) {
    redirect(back(from, date, "error=invalid_request"));
  }

  const context = await dispatcherSession(home(from));
  if (!("client" in context)) redirect(back(from, date, `error=${context.error}`));

  let result;
  try {
    result = await context.client.PUT("/fleet/status/{vehicleId}", {
      params: { path: { vehicleId } },
      body: { date, status, note: note || null },
    });
  } catch {
    redirect(back(from, date, "error=fleet_outcome_unknown"));
  }
  if (result.error || !result.data) {
    if (result.response.status === 409) redirect(back(from, date, "error=fleet_locked"));
    if (result.response.status === 404) redirect(back(from, date, "error=stale"));
    redirect(back(from, date, "error=fleet_outcome_unknown"));
  }

  revalidateDesk();
  redirect(back(from, date, `notice=${result.data.hasDraft ? "fleet_updated_draft" : "fleet_updated"}`));
}
