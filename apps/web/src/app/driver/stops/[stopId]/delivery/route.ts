import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { buildDeliveryEvents } from "../../../delivery-events";
import { parseDeliveryRequest } from "../../../delivery-request";
import { submitStopEvents } from "../../../submit-events.server";

export const dynamic = "force-dynamic";

/**
 * Completes a delivery: one fact per order and the proof of delivery, whose
 * pages are the reason this is a route and not a server action (a full set of
 * receipt pages is several megabytes; a server action takes 1 MB by default).
 *
 * A route handler is not behind the layout's guard, so it asks the API who the
 * caller is. The API then authorises the stop against the caller's own run.
 */
export async function POST(request: Request, { params }: { params: Promise<{ stopId: string }> }) {
  const { stopId } = await params;

  const client = await api();
  const me = await client.GET("/auth/me").catch(() => null);
  if (!me || me.response.status === 401) {
    return NextResponse.json({ ok: false, error: "Your session expired. Sign in again before saving this delivery.", unknown: false }, { status: 401 });
  }
  if (me.error || me.data?.role !== "DRIVER") {
    return NextResponse.json({ ok: false, error: "This account cannot record deliveries.", unknown: false }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "This delivery could not be read. Reload the stop and try again.", unknown: false }, { status: 400 });
  }
  const parsed = parseDeliveryRequest(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error, unknown: false }, { status: 422 });

  const { value } = parsed;
  const result = await submitStopEvents({
    stopId,
    deviceId: value.deviceId,
    action: "complete the delivery",
    events: buildDeliveryEvents({
      lines: value.lines,
      podEventId: value.podEventId,
      occurredAt: value.occurredAt,
      recipientName: value.recipientName,
      pages: value.pages,
    }),
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.unknown ? 502 : 409 });
  }
  revalidatePath(`/driver/stops/${stopId}`);
  revalidatePath("/driver");
  return NextResponse.json(result);
}
