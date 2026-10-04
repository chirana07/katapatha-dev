import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readFailure } from "@/lib/failures";
import { agoFrom } from "@/lib/format";
import { readOf } from "@/lib/read-result";
import { ACTIVITY_PATH, ENTITY_FILTERS, actionWords, activityHref, parseEntity, whenText } from "./activity-view";

export const metadata: Metadata = { title: "Activity · Katapatha" };
export const dynamic = "force-dynamic";

const LIMIT = 100;

/**
 * The decision log, newest first, across every depot: who did what to which
 * record. It is the same log each record's own history is read from, so an
 * admin's changes to accounts, outlets and vehicles sit beside the operational
 * decisions they affect.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("ADMIN", ACTIVITY_PATH);
  const entity = parseEntity((await searchParams).entity);
  const client = await api();
  const result = await readOf(
    client.GET("/admin/activity", { params: { query: { limit: String(LIMIT), ...(entity ? { entityType: entity } : {}) } } }),
  );

  const header = <PageHeader title="Activity" subtitle="Every recorded decision, newest first: who, what, and to which record." />;
  const tabs = (
    <Tabs
      label="Record kind"
      items={[
        { label: "All", href: activityHref(null), current: entity === null },
        ...ENTITY_FILTERS.map((f) => ({ label: f.label, href: activityHref(f.value), current: entity === f.value })),
      ]}
    />
  );

  if (!result.ok) {
    const failure = readFailure(result.status, "the activity log");
    return (
      <PageBody>
        {header}
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome="read"
          action={
            <ButtonLink href={activityHref(entity)} variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </PageBody>
    );
  }

  const entries = result.data;

  return (
    <PageBody>
      {header}
      {tabs}
      <DataTable
        caption="Decision log"
        empty={entries.length === 0 ? <EmptyState title="Nothing recorded yet" detail="Decisions appear here as people make them." /> : undefined}
        head={
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>What</Th>
            <Th>Record</Th>
            <Th>Note</Th>
          </tr>
        }
        cards={entries.map((e) => (
          <RowCard key={e.id}>
            <p className="font-semibold text-ink">{actionWords(e.action)}</p>
            <p className="mt-1 text-sm text-muted">
              {e.actorName ?? "The system"} · {agoFrom(e.at)}
            </p>
            <p className="mt-1 font-mono text-xs text-muted">
              {e.entityType} {e.entityId}
            </p>
            {e.note ? <p className="mt-1 text-sm text-muted">{e.note}</p> : null}
          </RowCard>
        ))}
      >
        {entries.map((e) => (
          <Tr key={e.id}>
            <Td>
              <span className="tabular" title={e.at}>
                {whenText(e.at)}
              </span>
              <span className="block text-xs text-muted">{agoFrom(e.at)}</span>
            </Td>
            <Td>{e.actorName ?? <span className="text-muted">The system</span>}</Td>
            <Td>{actionWords(e.action)}</Td>
            <Td>
              <span className="text-muted">{e.entityType}</span> <span className="font-mono text-xs">{e.entityId}</span>
            </Td>
            <Td>{e.note ?? <span className="text-muted">—</span>}</Td>
          </Tr>
        ))}
      </DataTable>
      {entries.length === LIMIT ? <p className="text-xs text-muted">Showing the newest {LIMIT}.</p> : null}
    </PageBody>
  );
}
