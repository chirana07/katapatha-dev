import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { DateRangeControl } from "@/components/ui/date-range-control";
import { Glyph } from "@/components/ui/glyph";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { longDate } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { readOf } from "@/lib/read-result";
import {
  OVERVIEW_PATH,
  ON_TIME_TARGET_PCT,
  ROLE_LABEL,
  UTILISATION_TARGET_PCT,
  belowTarget,
  combine,
  parseRange,
  pctText,
} from "./overview-view";

export const metadata: Metadata = { title: "Overview · Katapatha" };
export const dynamic = "force-dynamic";

/**
 * Every depot side by side, over one date range.
 *
 * A dispatcher's reports answer for their own depot; this is the only place the
 * depots are compared, which is what the admin needs and nobody else may see.
 * The figures are the depot reports' own, computed by the same code, so a
 * number here and on a dispatcher's screen never disagree.
 */
export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("ADMIN", OVERVIEW_PATH);
  const range = parseRange(await searchParams);
  const client = await api();
  const result = await readOf(client.GET("/admin/overview", { params: { query: range } }));

  const header = (
    <PageHeader
      title="Overview"
      subtitle="Every depot, side by side. The same figures each depot's dispatcher sees."
      action={
        result.ok ? <DateRangeControl from={result.data.from} to={result.data.to} path={OVERVIEW_PATH} /> : undefined
      }
    />
  );

  if (!result.ok) {
    const failure =
      result.status === 422 && result.message
        ? { title: "That range cannot be shown", detail: result.message }
        : readFailure(result.status, "the overview");
    return (
      <PageBody>
        {header}
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome="read"
          action={
            <ButtonLink href={OVERVIEW_PATH} variant="secondary">
              Show the last seven days
            </ButtonLink>
          }
        />
      </PageBody>
    );
  }

  const { totals, depots, from, to } = result.data;
  const all = combine(depots);

  return (
    <PageBody>
      {header}

      <p className="text-sm text-muted">
        {longDate(from)} to {longDate(to)}
      </p>

      <StatRow>
        <StatCard
          icon={<Glyph name="check" />}
          value={pctText(all.onTimePct)}
          label="On-time delivery, all depots"
          foot={all.onTimePct === null ? "No stop had a recorded arrival" : `${plural(all.stops, "stop")} · target ${ON_TIME_TARGET_PCT}%`}
          footTone={belowTarget(all.onTimePct, ON_TIME_TARGET_PCT) ? "warn" : "neutral"}
        />
        <StatCard
          icon={<Glyph name="box" />}
          value={all.delivered.toLocaleString("en-GB")}
          label="Orders delivered"
          foot={`of ${all.orders.toLocaleString("en-GB")} planned · ${all.deferred.toLocaleString("en-GB")} deferred`}
        />
        <StatCard
          icon={<Glyph name="alert" />}
          value={all.discrepancies === null ? "—" : all.discrepancies.toLocaleString("en-GB")}
          label="Discrepancies"
          foot={all.discrepancies === null ? "Recorded only for days run in this system" : "Shortfalls, receipt differences and problems"}
        />
        <StatCard
          icon={<Glyph name="truck" />}
          value={`${totals.outlets} · ${totals.vehicles}`}
          label="Outlets · vehicles"
          foot={`${totals.activeUsers} of ${plural(totals.users, "account")} active`}
        />
      </StatRow>

      <section aria-labelledby="depots-heading" className="flex flex-col gap-3">
        <h2 id="depots-heading" className="text-base font-semibold text-ink">
          By depot
        </h2>
        <DataTable
          caption="Depots compared"
          head={
            <tr>
              <Th>Depot</Th>
              <Th numeric>On time</Th>
              <Th numeric>Delivered</Th>
              <Th numeric>Deferred</Th>
              <Th numeric>Utilisation</Th>
              <Th numeric>Discrepancies</Th>
              <Th numeric>Outlets</Th>
              <Th numeric>Vehicles</Th>
              <Th numeric>People</Th>
            </tr>
          }
          cards={depots.map((d) => (
            <RowCard key={d.depotCode}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-ink">{d.name}</p>
                <OnTimePill value={d.onTimePct} />
              </div>
              <p className="tabular mt-2 text-sm text-muted">
                {d.delivered} of {d.orders} delivered · {d.deferred} deferred · utilisation {pctText(d.utilisationPct)}
              </p>
              <p className="tabular mt-1 text-sm text-muted">
                {plural(d.outlets, "outlet")} · {plural(d.vehicles, "vehicle")} ({d.reefers} refrigerated) · {plural(d.activeUsers, "person", "people")}
              </p>
            </RowCard>
          ))}
        >
          {depots.map((d) => (
            <Tr key={d.depotCode}>
              <Td>
                <span className="font-semibold text-ink">{d.name}</span>
              </Td>
              <Td numeric>
                <OnTimePill value={d.onTimePct} />
              </Td>
              <Td numeric>
                {d.delivered.toLocaleString("en-GB")} <span className="text-muted">/ {d.orders.toLocaleString("en-GB")}</span>
              </Td>
              <Td numeric>{d.deferred.toLocaleString("en-GB")}</Td>
              <Td numeric>
                <span className={belowTarget(d.utilisationPct, UTILISATION_TARGET_PCT) ? "text-warn-ink" : undefined}>{pctText(d.utilisationPct)}</span>
              </Td>
              <Td numeric>{d.discrepancies === null ? "—" : d.discrepancies}</Td>
              <Td numeric>{d.outlets}</Td>
              <Td numeric>
                {d.vehicles} <span className="text-muted">({d.reefers} refr.)</span>
              </Td>
              <Td numeric>{d.activeUsers}</Td>
            </Tr>
          ))}
        </DataTable>
        <p className="text-xs text-muted">
          A dash means nothing was recorded to compute the figure from in this range — not zero. Utilisation and
          discrepancies are recorded only for days run in this system.
        </p>
      </section>

      <section aria-labelledby="people-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="people-heading" className="text-base font-semibold text-ink">
            Accounts
          </h2>
          <ButtonLink href="/admin/users" variant="secondary">
            Manage users
          </ButtonLink>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {totals.usersByRole.map((r) => (
            <li key={r.role} className="rounded-card border border-line bg-surface p-4">
              <p className="tabular text-2xl font-bold text-ink">{r.count}</p>
              <p className="text-sm text-muted">{ROLE_LABEL[r.role]}</p>
            </li>
          ))}
        </ul>
      </section>
    </PageBody>
  );
}

function OnTimePill({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  return <StatusPill label={pctText(value)} tone={belowTarget(value, ON_TIME_TARGET_PCT) ? "warn" : "good"} />;
}
