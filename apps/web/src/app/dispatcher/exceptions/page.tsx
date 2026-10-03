import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { DateControl } from "@/components/ui/date-control";
import { SplitLayout } from "@/components/ui/detail-panel";
import { Glyph } from "@/components/ui/glyph";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { isDateOnly, longDate, todayInColombo } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { plural } from "@/lib/format";
import { readOf } from "@/lib/read-result";
import { DecisionPanel } from "./decision-panel";
import { ExceptionList } from "./exception-list";
import { ActivityList, AffectedOutlets, PanelFacts, PanelHead, Standing } from "./panel-parts";
import {
  CATEGORY_LABEL,
  apiFilters,
  buildTabs,
  hrefFor,
  parseQuery,
  selection,
  severityChips,
  severityLabel,
  type ExceptionQuery,
  type ExceptionRow,
  type ExceptionSummary,
} from "./model";

const PLANNING = "/dispatcher/planning";

export const metadata = { title: "Exceptions · Katapatha" };

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("DISPATCHER", "/dispatcher/exceptions");
  const params = await searchParams;
  const query = parseQuery(params);
  // Links carry the date only when the dispatcher chose one, so "today" stays today.
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const explicitDate = isDateOnly(rawDate) ? query.date : null;
  const link = (change: Parameters<typeof hrefFor>[1] = {}) => hrefFor(query, change, explicitDate);

  const client = await api();
  const list = await readOf(client.GET("/exceptions", { params: { query: apiFilters(query) } }));
  if (!list.ok && list.status === 401) redirect(`/sign-in?next=${encodeURIComponent("/dispatcher/exceptions")}`);

  return (
    <PageBody>
      <PageHeader
        title="Exceptions"
        subtitle="Everything that needs a decision before or during delivery."
        aside={<DateControl date={query.date} path="/dispatcher/exceptions" keep={{ tab: query.tab === "open" ? undefined : query.tab, severity: query.severity ?? undefined, q: query.q || undefined }} />}
        action={<ButtonLink href={PLANNING}>Open planning</ButtonLink>}
      />

      {!list.ok ? (
        <ErrorPanel {...readFailure(list.status, "the exceptions list")} />
      ) : (
        <>
          <Summary summary={list.data.summary} date={query.date} />
          <section className="rounded-card border border-line bg-surface p-4">
            <Tabs
              label="Exception views"
              items={buildTabs(list.data.summary, query, (tab) => link({ tab, exception: null }))}
            />
            <Filters query={query} explicitDate={explicitDate} chips={severityChips(list.data.summary, query)} link={link} />

            <div className="mt-4">
              {list.data.exceptions.length === 0 ? (
                <Empty query={query} clearHref={link({ severity: null, q: "", exception: null })} />
              ) : (
                <SplitLayout
                  list={
                    <div id="exceptions-list">
                      <ExceptionList
                        rows={list.data.exceptions}
                        selectedId={selection(list.data.exceptions, query.exception).id}
                        hrefOf={(id) => `${link({ exception: id })}#exception-detail`}
                      />
                    </div>
                  }
                  panel={<Panel query={query} rows={list.data.exceptions} backHref={`${link({ exception: null })}#exceptions-list`} />}
                />
              )}
            </div>
          </section>
        </>
      )}
    </PageBody>
  );
}

function Summary({ summary, date }: { summary: ExceptionSummary; date: string }) {
  const today = date === todayInColombo();
  return (
    <StatRow>
      <StatCard
        icon={<Glyph name="alert" />}
        value={summary.open}
        label="Open exceptions"
        tone={summary.critical > 0 ? "bad" : "neutral"}
        foot={summary.critical > 0 ? `${summary.critical} critical · act before departure` : "None critical"}
        footTone={summary.critical > 0 ? "bad" : "neutral"}
      />
      <StatCard
        icon={<Glyph name="box" />}
        value={summary.ordersAffected}
        label="Orders affected"
        foot={`${plural(summary.outletsAffected, "outlet")} · ${plural(summary.vehiclesAffected, "vehicle")}`}
      />
      <StatCard
        icon={<Glyph name="check" />}
        value={summary.resolvedToday}
        label={today ? "Resolved today" : `Resolved on ${longDate(date)}`}
      />
      <StatCard
        icon={<Glyph name="timer" />}
        value={summary.avgResolveMinutes === null ? "—" : `${summary.avgResolveMinutes} min`}
        label="Avg. time to resolve"
        foot={summary.avgResolveMinutes === null ? "No resolved items to average yet" : undefined}
      />
    </StatRow>
  );
}

function Filters({
  query,
  explicitDate,
  chips,
  link,
}: {
  query: ExceptionQuery;
  explicitDate: string | null;
  chips: ReturnType<typeof severityChips>;
  link: (change?: Parameters<typeof hrefFor>[1]) => string;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
      <form method="get" action="/dispatcher/exceptions" role="search" className="flex min-w-0 lg:w-72">
        {explicitDate ? <input type="hidden" name="date" value={explicitDate} /> : null}
        {query.tab !== "open" ? <input type="hidden" name="tab" value={query.tab} /> : null}
        {query.severity ? <input type="hidden" name="severity" value={query.severity} /> : null}
        <label className="flex min-h-11 w-full items-center gap-2 rounded-control border border-line bg-surface px-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-link">
          <span className="sr-only">Search order, vehicle or outlet</span>
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="size-4 shrink-0 text-muted">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            maxLength={100}
            placeholder="Search order, vehicle or outlet…"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
          />
        </label>
      </form>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by severity">
        {chips.map((chip) => (
          <Link
            key={chip.key}
            href={link({ severity: chip.key === "all" ? null : chip.key, exception: null })}
            aria-current={chip.current ? "true" : undefined}
            className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${
              chip.current ? "border-rail bg-rail text-white" : "border-line bg-surface text-ink hover:bg-raised"
            }`}
          >
            {chip.label}
            {chip.count !== null ? <span className="tabular ml-1">({chip.count})</span> : null}
          </Link>
        ))}
      </div>
      <p className="text-sm text-muted lg:ml-auto">Sorted by departure time</p>
    </div>
  );
}

function Empty({ query, clearHref }: { query: ExceptionQuery; clearHref: string }) {
  const filtered = query.severity !== null || query.q !== "";
  if (filtered) {
    return (
      <EmptyState
        title="No exceptions match these filters"
        detail="Clear the search or severity filter to see everything in this view."
        action={<ButtonLink href={clearHref}>Clear filters</ButtonLink>}
      />
    );
  }
  if (query.tab === "resolved") {
    return <EmptyState title="Nothing resolved on this day" detail="Items appear here once a dispatcher has decided them." />;
  }
  const where = query.tab === "open" ? "" : ` under ${CATEGORY_LABEL[query.tab as keyof typeof CATEGORY_LABEL]}`;
  return (
    <EmptyState
      title={`Nothing needs a decision${where}`}
      detail="Shortfalls, chiller readings, late trips, Lamp Mode vehicles and reported problems appear here as they happen."
    />
  );
}

/**
 * The selected exception. The list already carries everything but the
 * activity, so the detail call is only for that, and for an id the list does
 * not hold (a link to something filtered out or since resolved).
 */
async function Panel({
  query,
  rows,
  backHref,
}: {
  query: ExceptionQuery;
  rows: ExceptionRow[];
  backHref: string;
}) {
  const { id, explicit } = selection(rows, query.exception);
  // Without a chosen row the panel is wide-screen only; see `selection`.
  const visibility = explicit ? "" : "hidden lg:block";
  if (!id) return null;

  const client = await api();
  const detail = await readOf(client.GET("/exceptions/{exceptionId}", { params: { path: { exceptionId: id } } }));

  if (!detail.ok) {
    const cleared = detail.status === 404;
    return (
      <div id="exception-detail" className={visibility}>
        <aside className="rounded-card border border-line bg-surface p-4">
          {cleared ? (
            <EmptyState
              title="That condition has cleared"
              detail="Chiller, late and Lamp Mode items disappear when the evidence changes, so there is nothing left to decide."
              action={<ButtonLink href={backHref}>Back to the list</ButtonLink>}
            />
          ) : (
            <ErrorPanel {...readFailure(detail.status, "this exception")} />
          )}
        </aside>
      </div>
    );
  }

  const row = detail.data;
  return (
    <div id="exception-detail" className={`scroll-mt-4 ${visibility}`}>
      <DecisionPanel
        // A different exception is a different panel: no chosen option carries across.
        key={row.id}
        exceptionId={row.id}
        options={row.decisionOptions}
        eyebrow={`${severityLabel(row.severity)} · ${CATEGORY_LABEL[row.category]}`}
        contextLine={`${row.title} · ${row.subtitle}`}
        before={
          <>
            <PanelHead row={row} backHref={backHref} />
            <PanelFacts row={row} />
            <AffectedOutlets outlets={row.affectedOutlets} />
          </>
        }
        after={<ActivityList events={detail.data.activity} />}
        noDecision={<Standing row={row} planningHref={PLANNING} />}
        noDecisionFooter={
          row.kind === "PLANNING" ? (
            <ButtonLink href={PLANNING} variant="primary" className="flex-1">
              Open planning
            </ButtonLink>
          ) : undefined
        }
      />
    </div>
  );
}
