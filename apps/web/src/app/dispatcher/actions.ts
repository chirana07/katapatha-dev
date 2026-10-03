"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { HOME_FOR_ROLE } from "@katapatha/core/domain/authPaths";
import { api } from "@/lib/api";

const HOME = "/dispatcher";

async function dispatcherContext() {
  let client;
  let me;
  try {
    client = await api();
    me = await client.GET("/auth/me");
  } catch {
    return { error: "unreachable" as const };
  }
  if (me.response.status === 401) redirect("/sign-in?next=/dispatcher");
  if (me.error || !me.data) return { client, error: "session" as const };
  if (me.data.role !== "DISPATCHER") redirect(HOME_FOR_ROLE[me.data.role]);
  if (!me.data.depotCode) return { client, error: "depot" as const };
  return { client, user: me.data };
}

/**
 * Back to the desk, keeping the `?date=` the dispatcher was looking at. Without
 * it a rehearsal on a past date (2026-04-09) bounced to today after every
 * action and showed "No planning day found".
 */
function desk(date: string, query: string) {
  return validDate(date) ? `${HOME}?date=${date}&${query}` : `${HOME}?${query}`;
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function closeQueue(formData: FormData) {
  const planningDayId = text(formData, "planningDayId");
  const view = text(formData, "date");
  if (!planningDayId) redirect(desk(view, "error=invalid_request"));

  const context = await dispatcherContext();
  if ("error" in context) redirect(desk(view, `error=${context.error}`));

  let result;
  try {
    result = await context.client.POST("/planning-days/{planningDayId}/closure", {
      params: { path: { planningDayId } },
    });
  } catch {
    redirect(desk(view, "error=close_outcome_unknown"));
  }

  if (result.error || !result.data) {
    const code = result.response.status === 403 ? "forbidden" : result.response.status === 404 ? "stale" : "close_outcome_unknown";
    redirect(desk(view, `error=${code}`));
  }

  revalidatePath(HOME);
  redirect(desk(view, "notice=queue_closed"));
}

export async function createPlan(formData: FormData) {
  const date = text(formData, "date");
  const depotCode = text(formData, "depotCode");
  const requestId = text(formData, "requestId");
  if (!validDate(date) || !depotCode || !validUuid(requestId)) {
    redirect(desk(date, "error=invalid_request"));
  }

  const context = await dispatcherContext();
  if ("error" in context) redirect(desk(date, `error=${context.error}`));
  if (context.user.depotCode !== depotCode) redirect(desk(date, "error=forbidden"));

  let result;
  try {
    result = await context.client.POST("/plans", {
      params: {
        header: { "Idempotency-Key": requestId },
      },
      body: { date, depotCode },
    });
  } catch {
    redirect(desk(date, `error=plan_outcome_unknown&retry=${requestId}`));
  }

  if (result.error || !result.data) {
    if (result.response.status === 409) redirect(desk(date, "error=queue_open"));
    if (result.response.status === 422) redirect(desk(date, "error=plan_invalid"));
    redirect(desk(date, `error=plan_outcome_unknown&retry=${requestId}`));
  }

  revalidatePath(HOME);
  redirect(desk(date, "notice=plan_created"));
}

export async function setVehicleStatus(formData: FormData) {
  const date = text(formData, "date");
  const vehicleId = text(formData, "vehicleId");
  const status = text(formData, "status");
  const note = text(formData, "note").slice(0, 200);
  if (!validDate(date) || !vehicleId || vehicleId.length > 32 || (status !== "AVAILABLE" && status !== "IN_WORKSHOP")) {
    redirect(desk(date, "error=invalid_request"));
  }

  const context = await dispatcherContext();
  if ("error" in context) redirect(desk(date, `error=${context.error}`));

  let result;
  try {
    result = await context.client.PUT("/fleet/status/{vehicleId}", {
      params: { path: { vehicleId } },
      body: { date, status, note: note || null },
    });
  } catch {
    redirect(desk(date, "error=unreachable"));
  }
  if (result.error || !result.data) {
    if (result.response.status === 409) redirect(desk(date, "error=fleet_locked"));
    if (result.response.status === 404) redirect(desk(date, "error=stale"));
    redirect(desk(date, "error=unreachable"));
  }

  revalidatePath(HOME);
  redirect(desk(date, `notice=${result.data.hasDraft ? "fleet_updated_draft" : "fleet_updated"}`));
}
