import type { ReactNode } from "react";
import type { components } from "@katapatha/contracts/types";
import { DateRangeControl } from "@/components/ui/date-range-control";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Advisory, ErrorPanel } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { readFailure } from "@/lib/failures";
import type { Read } from "@/lib/read-result";
import { plural } from "@/lib/format";
import { reportHref, type Range } from "./report-params";
import { rangeText } from "./report-format";

type HistorySource = components["schemas"]["HistorySource"];
type Coverage = components["schemas"]["Coverage"];

const TABS = [
  { key: "overview", label: "Overview", path: "/dispatcher/reports" },
  { key: "deliveries", label: "Deliveries", path: "/dispatcher/reports/deliveries" },
  { key: "fleet", label: "Fleet", path: "/dispatcher/reports/fleet" },
  { key: "outlets", label: "Outlets", path: "/dispatcher/reports/outlets" },
  { key: "exceptions", label: "Exceptions", path: "/dispatcher/reports/exceptions" },
  { key: "capacity", label: "Capacity forecast", path: "/dispatcher/reports/capacity-forecast" },
] as const;

export type ReportTab = (typeof TABS)[number]["key"];

const SUBTITLE: Record<ReportTab, string> = {
  overview: "Delivery performance across Fresh, Style and Tech.",
  deliveries: "Orders planned, delivered and deferred, by day and by brand.",
  fleet: "How each vehicle was used against its capacity.",
  outlets: "Every outlet with a stop in the range.",
  exceptions: "What went wrong, by kind and by day.",
  capacity: "Plan vehicles and refrigerated space ahead of paydays and festivals.",
};

/**
 * The frame every report tab shares: title, range control, the tab strip, and
 * (above the figures) where the data came from. One component so the tabs
 * cannot disagree about any of it.
 *
 * `requested` is what the URL asked for and is what the tab links carry, so
 * switching tabs keeps the dispatcher's own range, or keeps the API's default
 * when they never chose one. `shown` is the range the report actually covers.
 */
export function ReportFrame({
  active,
  requested,
  shown,
  keep,
  source,
  children,
}: {
  active: ReportTab;
  requested: Range;
  shown: Range;
  /** Other params a tab wants kept across range changes (the brand filter). */
  keep?: Record<string, string | undefined>;
  source?: { historySource: HistorySource; coverage?: Coverage };
  children: ReactNode;
}) {
  const path = TABS.find((t) => t.key === active)!.path;
  return (
    <PageBody>
      <PageHeader
        title="Reports"
        subtitle={SUBTITLE[active]}
        aside={<DateRangeControl from={shown.from} to={shown.to} path={path} keep={keep} />}
      />
      <Tabs
        label="Report views"
        items={TABS.map((tab) => ({
          label: tab.label,
          href: reportHref(tab.path, requested),
          current: tab.key === active,
        }))}
      />
      {source ? <HistoryNotice {...source} range={shown} /> : null}
      {children}
    </PageBody>
  );
}


/**
 * Where the numbers came from, always visible. Synthetic history is generated
 * for the development fixture, and a dispatcher must never mistake it for
 * delivery records; the API's own label says so and is shown in full.
 */
export function HistoryNotice({
  historySource,
  coverage,
  range,
}: {
  historySource: HistorySource;
  /** The capacity forecast reports weeks, not days, so it has none. */
  coverage?: Coverage;
  range: Range;
}) {
  return (
    <div className="flex flex-col gap-2">
      {historySource.kind === "synthetic" ? (
        <Advisory>
          <strong>Demo history — generated, not real delivery data.</strong> {historySource.label}
        </Advisory>
      ) : historySource.kind === "unknown" ? (
        <Advisory>
          <strong>The source of the historical days is not recorded.</strong> {historySource.label}
        </Advisory>
      ) : null}
      {coverage ? (
        <p className="text-xs text-muted">
          {range.from && range.to ? `${rangeText(range.from, range.to)}: ` : ""}
          {plural(coverage.liveDays, "day")} run in Katapatha · {plural(coverage.historyDays, "day")} from the analytics history ·{" "}
          {plural(coverage.emptyDays, "day")} with no data
        </p>
      ) : null}
    </div>
  );
}

/** A report that did not load. A rejected range gets the API's own explanation. */
export function ReportError({ failure, what }: { failure: Extract<Read<unknown>, { ok: false }>; what: string }) {
  if (failure.status === 422 && failure.message) {
    return <ErrorPanel title="That range cannot be reported" detail={failure.message} outcome="read" />;
  }
  return <ErrorPanel {...readFailure(failure.status, what)} />;
}

/** A titled card, the report screens' basic block. */
export function ReportCard({
  title,
  subtitle,
  aside,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  /** Takes two of the three columns on a wide screen (the chart or table beside a narrow card). */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-card border border-line bg-surface p-4 sm:p-5 ${wide ? "xl:col-span-2" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A figure the API could not back: a dash, and the reason beside it. */
export function Note({ children }: { children: ReactNode }) {
  return <span className="block text-xs font-normal text-muted">{children}</span>;
}
