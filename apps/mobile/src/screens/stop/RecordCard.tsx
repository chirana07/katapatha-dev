import { Fragment } from "react";
import { Card, Divider, KeyValueRow } from "@/ui/Card";
import { Pill } from "@/ui/Pill";
import type { Row, SyncStatus } from "@/driver/stop-detail";

/**
 * Label/value rows for what this phone recorded for a stop (and, once closed, the
 * outcome and where its records stand). Times in the rows are already qualified
 * ("07:58 · recorded on device") by the caller's view model.
 */
export function RecordCard({ rows, status }: { rows: Row[]; status?: SyncStatus | null }) {
  if (rows.length === 0 && !status) return null;
  return (
    <Card flush>
      {rows.map((row, index) => (
        <Fragment key={row.label}>
          {index > 0 ? <Divider /> : null}
          <KeyValueRow label={row.label} value={row.value} />
        </Fragment>
      ))}
      {status ? (
        <>
          {rows.length > 0 ? <Divider /> : null}
          <KeyValueRow
            label="Status"
            value={
              <Pill label={status.label} tone={status.tone} icon={status.phone ? "phone" : undefined} />
            }
          />
        </>
      ) : null}
    </Card>
  );
}
