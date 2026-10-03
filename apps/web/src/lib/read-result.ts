/**
 * An API call as a value, so a page can render "could not load" instead of
 * crashing.
 *
 * openapi-fetch reports a refusal (4xx/5xx) as `{ error, response }`, but a
 * network failure is a thrown TypeError. Pages that want to show an ErrorPanel
 * need both to look the same, and need the API's own `code` and `message` where
 * it gave one — several endpoints (a report range over 366 days, a decision on
 * a cleared exception) carry wording written for the person reading it.
 *
 * `status` 0 means no response at all.
 */
export type Read<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; code: string | null; message: string | null; details: unknown };

interface Settled<T> {
  data?: T;
  error?: unknown;
  response: { status: number };
}

export async function readOf<T>(call: Promise<Settled<T>>): Promise<Read<T>> {
  let settled: Settled<T>;
  try {
    settled = await call;
  } catch {
    return { ok: false, status: 0, code: null, message: null, details: null };
  }
  if (settled.data !== undefined && settled.error === undefined) {
    return { ok: true, data: settled.data, status: settled.response.status };
  }
  const body = (settled.error as { error?: { code?: unknown; message?: unknown; details?: unknown } } | undefined)?.error;
  return {
    ok: false,
    status: settled.response.status,
    code: typeof body?.code === "string" ? body.code : null,
    message: typeof body?.message === "string" ? body.message : null,
    details: body?.details ?? null,
  };
}
