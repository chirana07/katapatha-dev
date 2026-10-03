/**
 * Imports here are relative, not "@/...": vitest has no alias for it, and
 * this module is what the tests cover.
 */
import type { components } from "@katapatha/contracts/types";
import type { TabItem } from "@/components/ui/tabs";
import type { Tone } from "@/components/ui/status-pill";
import { dateParam } from "../../../lib/dates";

type Schemas = components["schemas"];
export type ExceptionRow = Schemas["Exception"];
export type ExceptionSummary = Schemas["ExceptionSummary"];
export type DecisionOption = Schemas["ExceptionDecisionOption"];
export type DecisionCode = Schemas["ExceptionDecisionCode"];
export type Severity = Schemas["ExceptionSeverity"];
export type Category = Schemas["ExceptionCategory"];

/**
 * The console's six tabs. Five are views of the OPEN items (all of them, then
 * one category each); the sixth is the resolved ones. They are search params,
 * so each view is linkable and the back button works.
 */
export const TABS = ["open", "planning", "loading", "on_the_road", "store", "resolved"] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABEL: Record<Tab, string> = {
  open: "Open",
  planning: "Planning",
  loading: "Loading",
  on_the_road: "On the road",
  store: "Store",
  resolved: "Resolved",
};

const SEVERITIES: readonly Severity[] = ["critical", "warning", "info"];

export interface ExceptionQuery {
  date: string;
  tab: Tab;
  severity: Severity | null;
  q: string;
  /** The `?exception=` id, when the dispatcher chose one. */
  exception: string | null;
}

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Search params to a query we are willing to send, ignoring anything unknown. */
export function parseQuery(params: Params, today?: string): ExceptionQuery {
  const tab = first(params.tab);
  const severity = first(params.severity);
  const exception = first(params.exception)?.trim();
  return {
    date: dateParam(params.date, today),
    tab: (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "open",
    severity: (SEVERITIES as readonly string[]).includes(severity ?? "") ? (severity as Severity) : null,
    q: (first(params.q) ?? "").trim().slice(0, 100),
    exception: exception && exception.length <= 200 ? exception : null,
  };
}

/** What `GET /exceptions` is asked. Resolved is its own status; the rest are open. */
export function apiFilters(query: ExceptionQuery) {
  return {
    date: query.date,
    status: query.tab === "resolved" ? ("resolved" as const) : ("open" as const),
    ...(query.tab !== "open" && query.tab !== "resolved" ? { category: query.tab } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.q ? { q: query.q } : {}),
  };
}

/**
 * A link to this page with some of the query changed. `date` is kept only when
 * it was explicit, so a link from "today" stays "today" tomorrow.
 */
export function hrefFor(
  query: ExceptionQuery,
  change: Partial<Record<"tab" | "severity" | "q" | "exception", string | null>> = {},
  explicitDate?: string | null,
): string {
  const next = { tab: query.tab as string, severity: query.severity as string | null, q: query.q, exception: query.exception, ...change };
  const search = new URLSearchParams();
  if (explicitDate) search.set("date", explicitDate);
  if (next.tab && next.tab !== "open") search.set("tab", next.tab);
  if (next.severity) search.set("severity", next.severity);
  if (next.q) search.set("q", next.q);
  if (next.exception) search.set("exception", next.exception);
  const text = search.toString();
  return text ? `/dispatcher/exceptions?${text}` : "/dispatcher/exceptions";
}

/**
 * Tab counts come from the summary, which describes the whole day and ignores
 * the filters, so a count never shrinks because the dispatcher searched.
 * "Resolved" is the day's resolved items.
 */
export function buildTabs(summary: ExceptionSummary, query: ExceptionQuery, link: (tab: Tab) => string): TabItem[] {
  const counts: Record<Tab, number> = {
    open: summary.open,
    planning: summary.countsByCategory.planning,
    loading: summary.countsByCategory.loading,
    on_the_road: summary.countsByCategory.on_the_road,
    store: summary.countsByCategory.store,
    resolved: summary.resolvedToday,
  };
  return TABS.map((tab) => ({
    label: TAB_LABEL[tab],
    href: link(tab),
    current: tab === query.tab,
    count: counts[tab],
  }));
}

export interface SeverityChip {
  key: Severity | "all";
  label: string;
  /** Null on the Resolved tab: the severity counts are of open items. */
  count: number | null;
  current: boolean;
}

export function severityChips(summary: ExceptionSummary, query: ExceptionQuery): SeverityChip[] {
  const counted = query.tab !== "resolved";
  return [
    { key: "all", label: "All severities", count: null, current: query.severity === null },
    ...SEVERITIES.map((severity) => ({
      key: severity,
      label: severity.charAt(0).toUpperCase() + severity.slice(1),
      count: counted ? summary.countsBySeverity[severity] : null,
      current: query.severity === severity,
    })),
  ];
}

export function severityTone(severity: Severity): Tone {
  return severity === "critical" ? "bad" : severity === "warning" ? "warn" : "info";
}

export function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export const CATEGORY_LABEL: Record<Category, string> = {
  planning: "Planning",
  loading: "Loading",
  on_the_road: "On the road",
  store: "Store",
};

/**
 * Which row the panel shows, and whether the dispatcher chose it. With no
 * choice the first row is shown on a wide screen (the design opens on the next
 * departure) but not on a phone, where an unrequested panel would sit under a
 * long list.
 */
export function selection(rows: readonly ExceptionRow[], requested: string | null): { id: string | null; explicit: boolean } {
  if (requested) return { id: requested, explicit: true };
  return { id: rows[0]?.id ?? null, explicit: false };
}

const ROLE_LABEL: Record<string, string> = {
  DISPATCHER: "Dispatcher",
  LOADER: "Loader",
  DRIVER: "Driver",
  STORE_MANAGER: "Store",
};

export function roleLabel(role: string | null): string | null {
  return role ? (ROLE_LABEL[role] ?? role) : null;
}

/** "Reported by Ranjith Silva (Loader)", or null for items derived from field reports. */
export function reportedByLine(reportedBy: ExceptionRow["reportedBy"]): string | null {
  const role = roleLabel(reportedBy.role);
  return role ? `Reported by ${reportedBy.name} (${role})` : null;
}

/** The option the panel opens on: the one the API recommends, else the first. */
export function defaultOption(options: readonly DecisionOption[]): DecisionOption | null {
  return options.find((option) => option.recommended) ?? options[0] ?? null;
}

/**
 * The modal's "What happens when you confirm" list, straight from the option's
 * own consequences. The API builds these from the same plan it executes, so
 * nothing is added or rephrased here.
 */
export function consequenceItems(consequences: DecisionOption["consequences"]): { who: string; detail: string }[] {
  return consequences.map((item) => ({ who: item.title, detail: item.detail }));
}

/** "Confirm and notify" when the decision reaches a store or a driver. */
export function confirmLabel(option: DecisionOption): string {
  return option.consequences.some((item) => item.audience === "store" || item.audience === "driver")
    ? "Confirm and notify"
    : "Confirm";
}

const DECIDED_AS: Record<string, string> = {
  SEND_SHORT: "send short",
  HOLD_ORDER: "hold the order for the next run",
  CANCEL_LINE: "cancel the order",
  MOVE_TO_TRIP_2: "move to the vehicle's later trip",
  ACKNOWLEDGE: "acknowledge",
  RESOLVE: "resolve",
};

/** A decision code as a phrase for a sentence; unknown codes pass through. */
export function decidedAs(code: string | null | undefined): string {
  if (!code) return "another decision";
  return DECIDED_AS[code] ?? code;
}

/** A unit quantity: "11 units". */
export function unitsLabel(count: number): string {
  return `${count} ${count === 1 ? "unit" : "units"}`;
}
