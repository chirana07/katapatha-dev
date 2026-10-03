import type { SqlDriver } from "../db/driver";

/**
 * What this phone has recorded for each stop, from outbox rows alone.
 *
 * The cache holds server truth and the outbox holds the driver's own work; the
 * "Delivery recorded" screen and the stop card need the second: when the driver
 * arrived, who signed, how many units they handed over, how many pages they
 * captured. None of that is in the run payload, and none of it needs a blob, so
 * this reads columns and counts only -- never signature_data, photo_data or
 * outbox_page.data -- which keeps the snapshot cheap and keeps images out of
 * memory, logs and crash reports.
 *
 * Which rows count: live ones (queued, sending, confirmed). A `rejected` row is
 * a record the server refused and a `conflict` row one it recorded but did not
 * apply; presenting either as "what you recorded" would overstate. The stop's
 * projection reports their state separately.
 *
 * Times are the DEVICE clock (occurredAt). Present them through
 * formatDeviceClock(); they are not the server's record of when it happened.
 */

export type StopOutcome = "DELIVERED" | "PART" | "FAILED" | "SKIPPED";

export type StopRecord = {
  /** Device clock (ISO) of the ARRIVED event, or null. */
  arrivedAt: string | null;
  /** Device clock of UNLOAD_START, or null. */
  unloadStartedAt: string | null;
  /**
   * Device clock the stop was closed: the POD, else the last DELIVERED /
   * PART_DELIVERED. For a FAILED or SKIPPED stop, that event's time.
   */
  completedAt: string | null;
  /** Who received the goods, from the POD (or a delivery line). */
  recipientName: string | null;
  /** One entry per order, the last recorded count winning. */
  lines: Array<{ orderId: string; deliveredUnits: number }>;
  /** Pages captured on the POD (legacy single images count as one page each). */
  pageCount: number;
  /** null until the stop is closed on this phone. */
  outcome: StopOutcome | null;
  /** The FAILED / SKIPPED reason code, else null. */
  reasonCode: string | null;
};

export function emptyStopRecord(): StopRecord {
  return {
    arrivedAt: null,
    unloadStartedAt: null,
    completedAt: null,
    recipientName: null,
    lines: [],
    pageCount: 0,
    outcome: null,
    reasonCode: null,
  };
}

type Row = {
  id: string;
  stop_id: string;
  type: string;
  occurred_at: string;
  order_id: string | null;
  delivered_units: number | null;
  recipient_name: string | null;
  reason_code: string | null;
  pages: number;
  legacy: number;
};

export async function readStopRecords(
  sql: SqlDriver,
  date: string,
): Promise<Map<string, StopRecord>> {
  // `IS NOT NULL` tests the legacy blob columns without returning them, and the
  // page subquery counts rows without selecting `data`.
  const rows = await sql.all<Row>(
    `SELECT e.id, e.stop_id, e.type, e.occurred_at, e.order_id, e.delivered_units,
            e.recipient_name, e.reason_code,
            (SELECT COUNT(*) FROM outbox_page p WHERE p.event_id = e.id) AS pages,
            (e.signature_data IS NOT NULL) + (e.photo_data IS NOT NULL) AS legacy
       FROM outbox_event e
       JOIN stop s ON s.id = e.stop_id
      WHERE s.date = ? AND e.state IN ('queued', 'sending', 'confirmed')
      ORDER BY e.id ASC`,
    [date],
  );

  const records = new Map<string, StopRecord>();
  const lineIndex = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const record = records.get(row.stop_id) ?? emptyStopRecord();
    records.set(row.stop_id, record);

    switch (row.type) {
      case "ARRIVED":
        record.arrivedAt ??= row.occurred_at;
        break;
      case "UNLOAD_START":
        record.unloadStartedAt ??= row.occurred_at;
        break;
      case "DELIVERED":
      case "PART_DELIVERED": {
        if (row.order_id !== null && row.delivered_units !== null) {
          const index = lineIndex.get(row.stop_id) ?? new Map<string, number>();
          lineIndex.set(row.stop_id, index);
          const at = index.get(row.order_id);
          if (at === undefined) {
            index.set(row.order_id, record.lines.length);
            record.lines.push({ orderId: row.order_id, deliveredUnits: row.delivered_units });
          } else {
            record.lines[at] = { orderId: row.order_id, deliveredUnits: row.delivered_units };
          }
        }
        record.recipientName = row.recipient_name ?? record.recipientName;
        record.outcome =
          row.type === "PART_DELIVERED" || record.outcome === "PART" ? "PART" : "DELIVERED";
        record.completedAt = row.occurred_at;
        record.reasonCode = null;
        break;
      }
      case "POD_CAPTURED":
        record.recipientName = row.recipient_name ?? record.recipientName;
        record.pageCount += row.pages > 0 ? row.pages : row.legacy;
        record.outcome ??= "DELIVERED";
        record.completedAt = row.occurred_at;
        break;
      case "FAILED":
      case "SKIPPED":
        record.outcome = row.type;
        record.reasonCode = row.reason_code;
        record.completedAt = row.occurred_at;
        break;
    }
  }

  return records;
}
