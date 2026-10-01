import "server-only";
import { api } from "@/lib/api";
import { FALLBACK_SHORTFALL_REASONS, type ShortfallReason } from "./reasons";

export async function fetchShortfallReasons(): Promise<{ reasons: ShortfallReason[]; fallback: boolean }> {
  const client = await api();
  const result = await client.GET("/reference/vocabularies", {});
  if (result.error || !result.data || !Array.isArray(result.data.shortfallReasons)) {
    return { reasons: FALLBACK_SHORTFALL_REASONS, fallback: true };
  }
  return { reasons: result.data.shortfallReasons, fallback: false };
}
