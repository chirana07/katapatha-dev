import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import type { Read } from "@/lib/read-result";
import { parseRange, type Range } from "./report-params";

type Params = Record<string, string | string[] | undefined>;

/**
 * What every report tab does first: check the role (a layout cannot guard a
 * page's data), read the range the URL asked for, and get the API client.
 */
export async function prepare(searchParams: Promise<Params>, here: string): Promise<{
  params: Params;
  requested: Range;
  client: Awaited<ReturnType<typeof api>>;
}> {
  await requireRole("DISPATCHER", here);
  const params = await searchParams;
  return { params, requested: parseRange(params), client: await api() };
}

/** A 401 mid-render means the session ended: back to sign-in, then here again. */
export function signInIfExpired(result: Read<unknown>, here: string) {
  if (!result.ok && result.status === 401) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
}
