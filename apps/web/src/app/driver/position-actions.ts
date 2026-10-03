"use server";

import { requireRole } from "@/lib/auth";
import { api } from "@/lib/api";
import { buildPingPayload, pingRefusalCopy, type PingFix } from "./position-share";

export type PingResult = { ok: true; sentAt: string } | { ok: false; error: string };

/**
 * Files one position report for the driver's claimed vehicle.
 *
 * Called only after the driver has switched sharing on, and only while the
 * page is open. A repeat is safe: the API keys reports by `clientPingId`.
 */
export async function reportPosition(input: {
  fix: PingFix;
  recordedAtMs: number;
  clientPingId: string;
}): Promise<PingResult> {
  await requireRole("DRIVER", "/driver");

  const payload = buildPingPayload(input.fix, input.recordedAtMs, input.clientPingId);
  if (!payload || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(input.clientPingId)) {
    return { ok: false, error: "The phone gave a position Katapatha could not use." };
  }

  try {
    const client = await api();
    const result = await client.POST("/drivers/me/pings", { body: { pings: [payload] } });
    if (result.error || !result.data) {
      const body = result.error as { error?: { code?: string } } | undefined;
      return { ok: false, error: pingRefusalCopy(result.response.status, body?.error?.code) };
    }
    return { ok: true, sentAt: payload.recordedAt };
  } catch {
    return { ok: false, error: pingRefusalCopy(0) };
  }
}
