import { describe, expect, it } from "vitest";
import {
  apiFilters,
  buildTabs,
  confirmLabel,
  consequenceItems,
  decidedAs,
  defaultOption,
  hrefFor,
  parseQuery,
  reportedByLine,
  selection,
  severityChips,
  type DecisionOption,
  type ExceptionRow,
  type ExceptionSummary,
} from "./model";

const summary: ExceptionSummary = {
  open: 7,
  critical: 3,
  ordersAffected: 11,
  outletsAffected: 4,
  vehiclesAffected: 3,
  resolvedToday: 12,
  avgResolveMinutes: 18,
  countsByCategory: { planning: 2, loading: 2, on_the_road: 2, store: 1 },
  countsBySeverity: { critical: 3, warning: 3, info: 1 },
};

const TODAY = "2026-10-03";

function option(partial: Partial<DecisionOption>): DecisionOption {
  return {
    decision: "SEND_SHORT",
    label: "Send short",
    description: "",
    recommended: false,
    requiresNote: false,
    followUp: null,
    consequences: [],
    ...partial,
  };
}

describe("parseQuery", () => {
  it("defaults to the open tab, today, no filters", () => {
    expect(parseQuery({}, TODAY)).toEqual({ date: TODAY, tab: "open", severity: null, q: "", exception: null });
  });

  it("ignores values it does not recognise", () => {
    const query = parseQuery({ tab: "everything", severity: "dire", date: "2026-02-30" }, TODAY);
    expect(query).toMatchObject({ tab: "open", severity: null, date: TODAY });
  });

  it("keeps a chosen tab, severity, search and exception", () => {
    const query = parseQuery({ tab: "on_the_road", severity: "warning", q: " VEH101 ", exception: "late:abc", date: "2026-04-09" }, TODAY);
    expect(query).toEqual({ date: "2026-04-09", tab: "on_the_road", severity: "warning", q: "VEH101", exception: "late:abc" });
  });

  it("caps the search at what the API accepts", () => {
    expect(parseQuery({ q: "x".repeat(300) }, TODAY).q).toHaveLength(100);
  });
});

describe("apiFilters", () => {
  it("asks for all open items on the Open tab", () => {
    expect(apiFilters(parseQuery({}, TODAY))).toEqual({ date: TODAY, status: "open" });
  });

  it("narrows a category tab to open items of that category", () => {
    expect(apiFilters(parseQuery({ tab: "loading", severity: "critical", q: "VEH" }, TODAY))).toEqual({
      date: TODAY,
      status: "open",
      category: "loading",
      severity: "critical",
      q: "VEH",
    });
  });

  it("asks for resolved items, with no category, on the Resolved tab", () => {
    expect(apiFilters(parseQuery({ tab: "resolved" }, TODAY))).toEqual({ date: TODAY, status: "resolved" });
  });
});

describe("hrefFor", () => {
  const query = parseQuery({ tab: "store", severity: "info", q: "OUT074" }, TODAY);

  it("keeps the rest of the query when one part changes", () => {
    expect(hrefFor(query, { exception: "problem:1" })).toBe("/dispatcher/exceptions?tab=store&severity=info&q=OUT074&exception=problem%3A1");
  });

  it("drops what is cleared and omits the default tab", () => {
    expect(hrefFor(query, { tab: "open", severity: null, q: "" })).toBe("/dispatcher/exceptions");
  });

  it("carries a date only when one was chosen", () => {
    expect(hrefFor(query, {}, "2026-04-09")).toContain("date=2026-04-09");
    expect(hrefFor(query, {})).not.toContain("date=");
  });
});

describe("buildTabs", () => {
  const tabs = buildTabs(summary, parseQuery({ tab: "loading" }, TODAY), (tab) => `#${tab}`);

  it("counts each category from the summary, the day's open items under Open and resolved ones under Resolved", () => {
    expect(tabs.map((t) => [t.label, t.count])).toEqual([
      ["Open", 7],
      ["Planning", 2],
      ["Loading", 2],
      ["On the road", 2],
      ["Store", 1],
      ["Resolved", 12],
    ]);
  });

  it("marks only the current tab", () => {
    expect(tabs.filter((t) => t.current).map((t) => t.label)).toEqual(["Loading"]);
  });
});

describe("severityChips", () => {
  it("shows counts on open views and none on Resolved, where they would be about other items", () => {
    expect(severityChips(summary, parseQuery({}, TODAY)).map((c) => c.count)).toEqual([null, 3, 3, 1]);
    expect(severityChips(summary, parseQuery({ tab: "resolved" }, TODAY)).map((c) => c.count)).toEqual([null, null, null, null]);
  });

  it("marks All when no severity is chosen", () => {
    expect(severityChips(summary, parseQuery({}, TODAY)).find((c) => c.current)?.key).toBe("all");
    expect(severityChips(summary, parseQuery({ severity: "info" }, TODAY)).find((c) => c.current)?.key).toBe("info");
  });
});

describe("selection", () => {
  const rows = [{ id: "a" }, { id: "b" }] as ExceptionRow[];

  it("opens the first row, unrequested, when none was chosen", () => {
    expect(selection(rows, null)).toEqual({ id: "a", explicit: false });
  });

  it("honours a requested id even when the list does not hold it", () => {
    expect(selection(rows, "zzz")).toEqual({ id: "zzz", explicit: true });
  });

  it("selects nothing in an empty list", () => {
    expect(selection([], null)).toEqual({ id: null, explicit: false });
  });
});

describe("decision options", () => {
  it("prefers the recommended option, then the first", () => {
    const a = option({ decision: "HOLD_ORDER" });
    const b = option({ decision: "SEND_SHORT", recommended: true });
    expect(defaultOption([a, b])).toBe(b);
    expect(defaultOption([a])).toBe(a);
    expect(defaultOption([])).toBeNull();
  });

  it("maps consequences one for one, unchanged", () => {
    const items = consequenceItems([
      { audience: "store", title: "Store · OUT074", detail: "Told before departure." },
      { audience: "record", title: "Decision record", detail: "Logged." },
    ]);
    expect(items).toEqual([
      { who: "Store · OUT074", detail: "Told before departure." },
      { who: "Decision record", detail: "Logged." },
    ]);
  });

  it("says notify only when someone outside the desk is told", () => {
    expect(confirmLabel(option({ consequences: [{ audience: "store", title: "s", detail: "d" }] }))).toBe("Confirm and notify");
    expect(confirmLabel(option({ consequences: [{ audience: "record", title: "r", detail: "d" }] }))).toBe("Confirm");
  });

  it("names a decision in a sentence and passes unknown ones through", () => {
    expect(decidedAs("HOLD_ORDER")).toBe("hold the order for the next run");
    expect(decidedAs("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(decidedAs(null)).toBe("another decision");
  });
});

describe("reportedByLine", () => {
  it("names a person and their role", () => {
    expect(reportedByLine({ name: "Ranjith Silva", role: "LOADER" })).toBe("Reported by Ranjith Silva (Loader)");
  });

  it("says nothing for items derived from field reports", () => {
    expect(reportedByLine({ name: "System", role: null })).toBeNull();
  });
});
