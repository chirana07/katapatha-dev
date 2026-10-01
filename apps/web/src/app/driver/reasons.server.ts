import "server-only";
import { api } from "@/lib/api";
import { FALLBACK_PROBLEM_REASONS } from "./reasons";

export async function fetchProblemReasons(): Promise<{ reasons: string[]; fallback: boolean }> {
  const client = await api();
  const result = await client.GET("/reference/vocabularies", {});
  if (result.error || !result.data || !Array.isArray(result.data.problemReasons)) {
    return { reasons: FALLBACK_PROBLEM_REASONS, fallback: true };
  }
  return { reasons: result.data.problemReasons, fallback: false };
}
