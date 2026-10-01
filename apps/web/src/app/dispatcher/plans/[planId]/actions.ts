"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { HOME_FOR_ROLE } from "@katapatha/core/domain/authPaths";
import { api } from "@/lib/api";

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

export async function publishPlan(formData: FormData) {
  const planId = field(formData, "planId");
  const requestId = field(formData, "requestId");
  const home = planPath(planId);
  if (!planId || planId.length > 128 || !validRequestId(requestId)) redirect("/dispatcher?error=invalid_request");

  let client;
  let me;
  try {
    client = await api();
    me = await client.GET("/auth/me");
  } catch {
    redirect(`${home}?error=unreachable`);
  }
  if (me.response.status === 401) redirect(`/sign-in?next=${encodeURIComponent(home)}`);
  if (me.error || !me.data) redirect(`${home}?error=session`);
  if (me.data.role !== "DISPATCHER") redirect(HOME_FOR_ROLE[me.data.role]);

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
  if (plan.response.status === 403 || validation.response.status === 403) redirect("/dispatcher?error=forbidden");
  if (plan.error || !plan.data || validation.error || !validation.data) redirect(`${home}?error=stale`);
  if (plan.data.status !== "DRAFT") redirect(`${home}?error=already_published`);
  if (validation.data.blocking) redirect(`${home}?error=validation_blocked`);

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
    if (result.response.status === 403) redirect("/dispatcher?error=forbidden");
    if (result.response.status === 409) redirect(`${home}?error=already_published`);
    if (result.response.status === 422) redirect(`${home}?error=validation_blocked`);
    redirect(`${home}?error=publish_outcome_unknown&retry=${requestId}`);
  }

  revalidatePath("/dispatcher");
  revalidatePath(home);
  redirect(`${home}?notice=published`);
}
