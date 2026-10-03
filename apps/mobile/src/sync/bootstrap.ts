import type { SqlDriver } from "../db/driver";
import { getApi } from "../api/client";
import { FALLBACK_PROBLEM_REASONS } from "../driver/reasons";
import { replaceRun, replaceVocabulary, type Run } from "./runRepo";

/**
 * Fills the device cache for one operating date.
 *
 * GET /sync/bootstrap is the endpoint designed for this: one call returning the
 * run AND the vocabularies, which is "everything the device must cache to work
 * with no connectivity".
 *
 * apps/api implements it. The fallback to GET /drivers/me/run plus GET
 * /reference/vocabularies is kept for a server that answers 501 (a build without
 * the sync routes): two calls instead of one and no serverSeq, but the same
 * cache contents -- which means the screens do not have to know which path ran.
 */

export type BootstrapResult =
  | { kind: "ok"; serverSeq: number | null; usedFallback: boolean; vocabularyFromServer: boolean }
  /** The driver has not claimed a vehicle today. Business state, not an error. */
  | { kind: "no-vehicle" }
  | { kind: "expired" }
  | { kind: "offline" }
  | { kind: "server"; status: number };

export async function bootstrap(
  sql: SqlDriver,
  date: string,
  now: Date = new Date(),
): Promise<BootstrapResult> {
  const client = await getApi(sql);

  let result;
  try {
    result = await client.GET("/sync/bootstrap", { params: { query: { date } } });
  } catch {
    return { kind: "offline" };
  }

  if (result.response.status === 501) {
    return bootstrapViaRun(sql, date, now);
  }
  if (result.response.status === 401) return { kind: "expired" };
  // 403 on the driver endpoints means "no vehicle claimed today", which the web
  // console also treats as a screen state rather than a failure.
  if (result.response.status === 403) return { kind: "no-vehicle" };
  if (!result.response.ok || !result.data) {
    return { kind: "server", status: result.response.status };
  }

  await replaceRun(sql, result.data.run as Run, now.toISOString());
  await replaceVocabulary(
    sql,
    "problemReasons",
    result.data.vocabularies.problemReasons,
  );

  return {
    kind: "ok",
    serverSeq: result.data.serverSeq ?? null,
    usedFallback: false,
    vocabularyFromServer: true,
  };
}

/** The fallback path (501 from /sync/bootstrap): the run and the vocabularies separately. */
async function bootstrapViaRun(
  sql: SqlDriver,
  date: string,
  now: Date,
): Promise<BootstrapResult> {
  const client = await getApi(sql);

  let runResult;
  try {
    runResult = await client.GET("/drivers/me/run", { params: { query: { date } } });
  } catch {
    return { kind: "offline" };
  }

  if (runResult.response.status === 401) return { kind: "expired" };
  if (runResult.response.status === 403) return { kind: "no-vehicle" };
  if (!runResult.response.ok || !runResult.data) {
    return { kind: "server", status: runResult.response.status };
  }

  await replaceRun(sql, runResult.data as Run, now.toISOString());

  // The reason list is a separate, non-fatal concern. A driver must still be able
  // to report a problem if this call fails -- they just get the local fallback,
  // and the screen says so, exactly as the web console's banner does.
  let vocabularyFromServer = false;
  try {
    const vocab = await client.GET("/reference/vocabularies", {});
    if (vocab.response.ok && Array.isArray(vocab.data?.problemReasons)) {
      await replaceVocabulary(sql, "problemReasons", vocab.data.problemReasons);
      vocabularyFromServer = true;
    }
  } catch {
    // Non-fatal by design.
  }

  if (!vocabularyFromServer) {
    await replaceVocabulary(sql, "problemReasons", FALLBACK_PROBLEM_REASONS);
  }

  return { kind: "ok", serverSeq: null, usedFallback: true, vocabularyFromServer };
}
