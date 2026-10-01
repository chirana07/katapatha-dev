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
  if (!planningDayId) redirect(`${HOME}?error=invalid_request`);

  const context = await dispatcherContext();
  if ("error" in context) redirect(`${HOME}?error=${context.error}`);

  let result;
  try {
    result = await context.client.POST("/planning-days/{planningDayId}/closure", {
      params: { path: { planningDayId } },
    });
  } catch {
    redirect(`${HOME}?error=close_outcome_unknown`);
  }

  if (result.error || !result.data) {
    const code = result.response.status === 403 ? "forbidden" : result.response.status === 404 ? "stale" : "close_outcome_unknown";
    redirect(`${HOME}?error=${code}`);
  }

  revalidatePath(HOME);
  redirect(`${HOME}?notice=queue_closed`);
}

export async function createPlan(formData: FormData) {
  const date = text(formData, "date");
  const depotCode = text(formData, "depotCode");
  const requestId = text(formData, "requestId");
  if (!validDate(date) || !depotCode || !validUuid(requestId)) {
    redirect(`${HOME}?error=invalid_request`);
  }

  const context = await dispatcherContext();
  if ("error" in context) redirect(`${HOME}?error=${context.error}`);
  if (context.user.depotCode !== depotCode) redirect(`${HOME}?error=forbidden`);

  let result;
  try {
    result = await context.client.POST("/plans", {
      params: {
        header: { "Idempotency-Key": requestId },
      },
      body: { date, depotCode },
    });
  } catch {
    redirect(`${HOME}?error=plan_outcome_unknown&retry=${requestId}`);
  }

  if (result.error || !result.data) {
    if (result.response.status === 409) redirect(`${HOME}?error=queue_open`);
    if (result.response.status === 422) redirect(`${HOME}?error=plan_invalid`);
    redirect(`${HOME}?error=plan_outcome_unknown&retry=${requestId}`);
  }

  revalidatePath(HOME);
  redirect(`${HOME}?notice=plan_created`);
}
